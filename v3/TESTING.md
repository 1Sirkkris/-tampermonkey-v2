# BWU2 Tampermonkey V3 — Preliminary Test Pack

FCResearch version: 0.1.1\nOther preliminary suites: 0.1.0
Branch: `v3-rebuild`

## Installers

- FCResearch Suite: `v3/dist/BWU2_V3_FCResearch.user.js`
- AFT Suite: `v3/dist/BWU2_V3_AFT.user.js`
- Hierarchy: `v3/dist/BWU2_V3_Hierarchy.user.js`
- MoveApp: `v3/dist/BWU2_V3_MoveApp.user.js`
- FNSKU Mapping: `v3/dist/BWU2_V3_FNSKU.user.js`
- PO Portal: `v3/dist/BWU2_V3_PO_Portal.user.js`
- Carton PrEditor: `v3/dist/BWU2_V3_Carton.user.js`
- Calm Code: `v3/dist/BWU2_V3_Calm.user.js`
- SIM Toolbar: `v3/dist/BWU2_V3_SIM.user.js`

All production test installers are self-contained. They have no runtime `@require` dependency on V2.

## Test rule

Disable the corresponding V2 script before testing its V3 replacement. V3 is designed to run with V2 completely absent.

Start with normal/small known workflows. Do not deliberately manufacture an ambiguous live inventory mutation merely to test UNKNOWN handling.

## Recommended order

1. FCResearch normal search/read-only FCR tab.
2. Tote Audit on a small known container.
3. FNSKU Mapping using a mapping you already know.
4. MoveApp with one known container.
5. Hierarchy Unbind with one known container.
6. AFT / ISS Move with one small known move.
7. ISS Sideline with one small known workflow.
8. PO Portal / Calm / Carton / SIM.
9. RIVER capture + assisted workflow.
10. Bind after learning the native Bind template.

## FCResearch Suite

Tabs:
- FCR
- TOTE
- ISS
- RIVER
- OBS

### Sideline
- No hidden iframe/worker.
- Direct Poirot transport.
- 2–5 style parallel preflight (current max 5).
- Hazmat/Pandash eligibility happens before move.
- Workflow expiry cache resets for a new workflow.
- Mixed expiry in the same workflow is ASIDE.
- Submitted move with lost confirmation becomes UNKNOWN and blocks rerun until **I VERIFIED IT · CLEAR ATTENTION**.
- Source auto-clear runs only when the workflow had no failed/aside quantity.

### RIVER
V3 stores:
- PO-line quantity
- live FCResearch inventory quantity

These are deliberately separate.

If both exist and disagree, Severity shows large **PO LINE** and **LIVE INVENTORY** quantity buttons plus a **MANUAL** quantity box. Clicking a quantity fills `Units impacted` and sets `Shipments impacted = 0`, but does **not** auto-click Next. Review the populated RIVER field, then continue manually.\n\nIf the two quantities agree, V3 keeps the fast path and fills/continues automatically.

Preliminary RIVER keeps these choice pages manual rather than selecting by brittle option number:
- Pandash choice
- Issue-at-FC choice
- Sortability choice
- Images dropdown
- Related TT review
- final Create Issue

ASIN, Information W1 and unambiguous Severity fields are automated.

## Hierarchy Bind first-use

Unbind is direct.

Bind has opaque native source/destination tokens that cannot safely be invented.

On first V3 Bind use:
1. Keep V3 enabled on the native Bind page.
2. Perform one normal native Bind to BWU1.
3. V3 passively learns the successful source + destination tokens.
4. V3 then shows **BIND TEMPLATE: READY**.
5. Future V3 Bind runs revalidate that saved destination still resolves to BWU1 before mutation.

Use **FORGET TEMPLATE** if you want to force re-learning.

## OBS

Telemetry is embedded at the actual V3 transport/operation layer rather than globally intercepting everything.

Key mutation outcomes:
- CONFIRMED
- REJECTED
- UNKNOWN

Export OBS from the suite when a workflow behaves unexpectedly.

## Build verification

From the `v3/` directory:

```bash
npm run verify
```

This checks:
- committed dist matches source/manifest,
- userscript syntax,
- no V2 globals/runtime `@require`,
- core regression tests.
