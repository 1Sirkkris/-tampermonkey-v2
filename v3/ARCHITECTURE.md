# V3 Architecture

## Rebuild doctrine

V3 is designed from required behavior and proven contracts, not from V2 file boundaries.

Before a module is implemented:
1. identify the workflow and user-visible contract,
2. identify the authoritative backend/API or DOM state,
3. identify evidence from V2/OBS/history showing what worked and what failed,
4. write the smallest fresh implementation that satisfies that contract,
5. add focused regression coverage,
6. only then consider whether any old workaround is still necessary.

Default assumption for historical patches is **do not carry forward**.

## Core runtime

Every suite is assembled from the same source-level core contracts:

- `core/api.js` — request transport, timeouts, auth/HTML rejection, response classification.
- `core/operation.js` — mutation state machine: PREPARED -> SUBMITTED -> CONFIRMED / REJECTED / UNKNOWN.
- `core/identity.js` — current authenticated employee identity with source/provenance.
- `core/storage.js` — namespaced state, schema versions, migrations and corruption handling.
- `core/queue.js` — sequential queues, pause/resume, ownership, recovery and attention states.
- `core/ui.js` — shared panel primitives, status, accessible state labels and owner markers.
- `core/print.js` — Printmon barcode printing with item-bound descriptions.
- `core/screenshot.js` — Ctrl+Q shared visibility contract using owner markers.
- `core/telemetry.js` — minimal structured operation telemetry; OBS redesign pending.
- `core/router.js` — host/path/hash feature activation; no module boots outside its route.

## Installed suites

### 1. FCResearch Suite
Routes:
- FCResearch native results
- Tote Audit
- ISS Console
- Sideline/Poirot worker route
- RIVER assistant bridge

Modules:
- FCR data/read layer
- product/inventory enhancements
- Tote Audit
- ISS Console
- Bin Check
- Stow helper
- RIVER bridge/assistant
- Sideline REBUILD-derived engine
- printing

Critical preservation:
- no visible Sideline worker popup
- same-origin hidden worker path where required
- Sideline REBUILD behavior is baseline
- early Super Preflight/hazmat behavior
- expiry prompt/cache remains workflow-scoped
- mixed-expiry destination protection
- exact/incomplete inventory semantics

### 2. AFT Suite
Routes:
- EditItems
- MoveItems
- FCSKU Flip

Principles:
- direct proven AFT state/action/status workflow
- operation ownership survives long batches
- uncertain submitted destination is UNKNOWN, not runnable retry
- existing successful quantity/state flows preserved unless evidence justifies change

### 3. Hierarchy Suite
Routes:
- Bind
- Unbind

Principles:
- one fresh canonical V3 implementation
- do not port standalone V2 Unbind
- do not port the merged V2 hierarchy source wholesale
- use proven Bind/Unbind backend behavior and live contracts as reference
- shared queue engine
- BWU1 bind destination validation
- automatic authenticated identity
- standalone V2 Unbind remains V2-only and is not a V3 rollback component

### 4. MoveApp Suite
Routes:
- MoveContainer / Dropzone

Principles:
- sequential API queue
- strict confirmation validation
- persisted phase-aware recovery
- submitted/unknown rows require verification before retry

### 5. FNSKU Mapping
Keep standalone because it is a separate domain/tool.
Preserve regional NA/EU -> ASIN -> JP/AU workflow.
Exact requested FNSKU/ASIN attribution only.

### 6. PO Portal
Keep standalone lightweight domain-specific tool.

### 7. Utilities
Low-overlap small tools routed by host:
- Calm Code
- Carton PrEditor
- SIM Markdown Toolbar

Screenshot Mode itself becomes shared core behavior across V3 suites rather than a separately duplicated host-specific implementation where practical.

### 8. OBS / Diagnostics
Not copied forward blindly.
Design goal:
- operation IDs
- suite + module + build version
- phase transitions
- confirmed / rejected / unknown outcome
- response class + timing
- no sensitive headers/tokens
- bounded retention
- low-noise export
- coverage of GM and native fetch/XHR paths
- dependency/build fingerprint

## Build/output layout

```
v3/
  src/
    core/
    suites/
      fcr/
      aft/
      hierarchy/
      moveapp/
      fnsku/
      poportal/
      utilities/
  dist/
  tests/
  fixtures/
  docs/
```

Production installs come only from `dist/`.
