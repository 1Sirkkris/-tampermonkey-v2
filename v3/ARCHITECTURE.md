# V3 Relaunch Architecture

## Installed apps

1. V3 | BWU2 FCResearch Toolkit
2. V3 | BWU2 ISS Console
3. V3 | BWU2 Edit Tools
4. V3 | BWU2 MoveItems
5. V3 | BWU2 Sideline
6. V3 | BWU2 Hierarchy
7. V3 | BWU2 MoveContainer
8. V3 | BWU2 RIVER Assistant
9. V3 | BWU2 FNSKU Mapping
10. V3 | BWU2 PO Portal
11. V3 | BWU2 Carton PrEditor
12. V3 | BWU2 Calm Code
13. V3 | BWU2 SIM Toolbar
14. V3 | BWU2 OBS + Screenshot

## FCResearch Toolkit

Passive dock buttons only. No automatic full inventory/product fan-out.

- Tote Audit
- Bin Check
- Pandash
- contextual MoveContainer
- contextual Unbind
- printing / exact item helpers
- small FCR quality indicators where cheap and trustworthy

## ISS Console

Dedicated standalone console hosted on Poirot at `#iss-console`. FCResearch never bundles or owns it; other tools may only navigate to it.

- EditItems / SKU / EACH
- MoveItems / ALL / QTY / EACH=1
- Sideline
- FCSKU Flip

It calls shared engines; it does not own separate backend implementations.

- Sideline runs locally on the Poirot host. No hidden FCResearch worker/page.
- Edit/Move/FCSKU call the shared AFT engine without making FCResearch the console host.
- V3 ISS updates independently from the FCResearch Toolkit.

## Native-page apps

- Edit Tools: AFT EditItems + FCSKU native routes
- MoveItems: AFT MoveItems native route
- Sideline: Poirot native route
- Hierarchy: Bind + Unbind native routes
- MoveContainer: MoveApp native route

## Shared core

- base: normalization and safe primitives
- lifecycle: deterministic cleanup
- storage: namespaced schema + batched GM storage
- transport: fetch / GM request classification
- operation: strict mutation state machine
- telemetry: sanitized cross-userscript event stream
- ui: shared dock + mutually exclusive lazy panels
- identity: strict authenticated identity evidence only
- print: Printmon adapter

## OBS

Every app emits sanitized JSON-string CustomEvents. A single OBS userscript listens across all supported hosts and stores a bounded fleet log in its own Tampermonkey storage. This captures GM-backed operations because telemetry is emitted at the operation itself, not inferred from page fetch hooks.
