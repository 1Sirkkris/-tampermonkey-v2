# V3 architecture

## Ownership

### FCResearch
Passive native-page helper. No eager product/inventory fan-out.

- Tote Audit
- Bin Check
- Pandash
- contextual MoveContainer
- contextual Unbind
- exact-code printing / copy helpers
- lightweight product/inventory indicators where evidence is trustworthy
- RIVER capture is owned by the RIVER script, not FCResearch

### ISS Console
Dedicated Poirot console.

- EditItems
- MoveItems
- Sideline
- FCSKU Flip

Sideline runs locally on Poirot using the same Sideline engine as the native Sideline helper.
AFT work uses the same AFT engine as the native AFT helper. ISS may use a hidden same-origin AFT worker bridge when required for authenticated AFT session ownership; no visible popup.

### Native apps
- AFT Tools: EditItems / MoveItems / FCSKU routes
- Sideline: Poirot native page
- Hierarchy: Bind + Unbind
- MoveContainer: MoveApp
- RIVER: FCR capture + native RIVER assistant
- FNSKU Mapping, PO Portal, Carton, Calm, SIM stay on their native pages

## Shared source

- `core.js`: normalization, lifecycle, state storage, operation state machine, queue, UI, telemetry, identity, transport.
- `fcr.js`: strict FCR reads and parsers.
- `aft.js`: canonical AFT state machine and Edit/Move/FCSKU workflows.
- `sideline.js`: canonical Poirot read/preflight/move engine.
- `actions.js`: MoveContainer + Hierarchy mutation contracts.
- app files own only UI and workflow orchestration.

## Mutation certainty

`PREPARED -> SUBMITTED -> CONFIRMED | REJECTED | UNKNOWN`

Terminal states cannot transition. A lost response after SUBMITTED is UNKNOWN, not failure and not retryable.

## State

- one owner per workflow
- active mutation state is explicit
- reload recovery converts active/submitted work to ATTENTION
- queued-but-unsubmitted work may resume
- clear/reset invalidates prior async generations

## Performance

- no interval polling while idle
- observers are targeted and coalesced
- FCR full inventory is on-demand
- stable lookups may be cached with bounded TTL
- panels mount lazily
