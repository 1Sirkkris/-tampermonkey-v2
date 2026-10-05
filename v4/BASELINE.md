# V4 clean-room baseline

Established 5 October 2026. Scope: inventory and rebuild sequence; no implementation in this checkpoint.

- V2 reference: `main` at `e4399d89ff11551ec1afb132d67c448da1e43568`.
- Frozen V3 reference: `v3-groundup` at `77ff9f7818ea8d2d53422654a7e6b7ca51b6db13`.
- Active target: `v4-cleanroom`, created from the verified V2 history. Existing root scripts remain untouched reference files. New implementation belongs under `v4/`; no V3 implementation was imported.
- Authority: [current V4 instructions](BRIEF.txt). Their automatic one-unit checkpoint rule replaces older V3 batch-approval rules. No agents are authorised.

## Inventory and classifications

`PRESERVE BEHAVIOUR` describes the user contract; `REBUILD` describes implementation. They apply together to retained workflows. `SHARE LATER` identifies responsibilities to consider after contracts prove the overlap, not an instruction to port a library. Installer count and module layout are deliberately undecided.

| V2 reference / responsibility | Classification | Preserve in V4 / real application dependencies |
|---|---|---|
| `BWU2_Observability_Core.user.js` | PRESERVE BEHAVIOUR + REBUILD | Useful version/evidence panel, export, clear, error and transaction evidence. Each V4 operation emits its own sanitized record; native browser traffic is supplementary. OBS is optional for workflow execution. |
| `FCR_Data_Core.user.js` | REBUILD; SHARE LATER | Exact product/identifier reads, complete inventory pagination, hierarchy/history and measurement reads, visible auth renewal. Authenticated FCR and Item Measurement/MADCAT; no old data-core global/event/storage protocol. |
| `FCResearch_Master.user.js` | PRESERVE BEHAVIOUR + REBUILD | Native FCR sections, load choices, exact bin description, identifier/quantity information, MADCAT/dimensions/hazmat checks, copy/print/link controls. Product + Inventory default loading; retain other section controls. Native FCR, measurement and label-print service. |
| `FC_Lite.user.js` | PRESERVE BEHAVIOUR + REBUILD | Tote Audit only at `#fcr-tote-checker`: container then physical scans, duplicate quantities, pending scans, reset, complete system inventory and all twelve columns, discrepancy/measurement helpers, Full FCResearch. Do not restore previously removed general FC-Lite sections. |
| `Bin_Check_Overlay.user.js` | PRESERVE BEHAVIOUR + REBUILD | Inventory-nav start control; snapshot current filtered rows, P-level/floor resolution, filter/sort/pause/close and summary. Native FCR/hierarchy reads. Ignore Tote Audit and ISS routes as V2 does. |
| `FNSKU_Mapping_Lookup.user.js` | PRESERVE BEHAVIOUR + REBUILD | Lookup/Enter, NA/EU/JP results and navigation, copy, Clear, minimize/debug and more-results handoff. Exact regional authenticated mapping tool; partial results stay visibly partial. |
| `Bind_Hierarchy_Queue.user.js` | PRESERVE BEHAVIOUR + REBUILD | Native Bind queue, scan/paste and destination sequence, template capture where required, Run/Pause/Clear, row outcomes/recovery. Native hierarchy validation/session and positive binding result. |
| `Unbind_Hierarchy_Queue.user.js` | PRESERVE BEHAVIOUR + REBUILD | Native Unbind queue and controls, saved rows and reload recovery. One owner for this workflow; do not reproduce two competing Unbind implementations. Hierarchy validation/summary/unbind. |
| `Dropzone_Selector_Queue.user.js` | PRESERVE BEHAVIOUR + REBUILD | Native MoveContainer dropzone/floor choices, queue/control scans, sequential Run/Pause/Clear and recovery rows. Native MoveContainer and authenticated employee identity. |
| `Stow_Andons_Helper.user.js` | PRESERVE BEHAVIOUR + REBUILD | Native FCR/Tote floor/dropzone/Prime/Unbind controls, conflict warnings, hover preferences, move then optional print. FCR identity/data, MoveContainer, hierarchy, print service. Ignore ISS route. |
| `Sideline_REBUILD_TEST.user.js` | PRESERVE BEHAVIOUR + REBUILD | Poirot native Queue + Lazy; scanner source/destination/item sequence and `123START`; QTY 1–10, duplicates, preflight/ASIDE reasons and expiry before movement, delay/clear-source choices, two-stage Stop and restart. Predicant rescans retain one recovery owner. Native Sideline APIs/identity; FCR preflight reads where required. |
| `AFT_Edit_SKU_Move.user.js` | PRESERVE BEHAVIOUR + REBUILD | Native Edit EACH/SKU, disposition/damage choices and inventory quantities; Move ALL/EACH/QTY, FCSKU Flip, scanner/keyboard/date helpers and Stop/Clear. Native AFT workflow/session/request/status contracts. |
| `ISS_Console.user.js` | PRESERVE BEHAVIOUR + REBUILD | Proven FCR `#iss-console` entry/exit, familiar three Edit/Move/Sideline areas, modes/defaults/quantity/expiry, control scans, row outcomes and Stop/Clear. Needs independent V4 Sideline/AFT capabilities and their authenticated native origins. Prior permission for another host is not a requirement to relocate the proven interface. |
| `FCResearch_RIVER_Ticket_Assistant.user.js` | PRESERVE BEHAVIOUR + REBUILD | FCR capture/handoff and native RIVER Run/Stop-Clear, quantity choice and step guidance, manual final gates. Exact FCR data and authenticated RIVER forms; ignore ISS route. |
| `SIM_Markdown_Toolbar.user.js` | PRESERVE BEHAVIOUR + REBUILD | Toolbar beside each native editor, selection/caret formatting, presets/snippet create/edit/delete/import/export, image/attachment controls including gallery and bulk download. Native SIM editor/attachments and V4-only preference storage. No dock replacement or silent feature reduction. |
| `Carton_PrEditor.user.js` | PRESERVE BEHAVIOUR + REBUILD | Native barcode/count helper, saved auto-complete toggle and sound; one Complete per ready carton. Carton native workflow fields/actions. |
| `Calm_Code.user.js` | PRESERVE BEHAVIOUR + REBUILD | Familiar role-code toolbox on native labor tracking/Calm pages, correct field entry and keyboard events. Native form and configured role codes. |
| `PO_Portal_Lite.user.js` | PRESERVE BEHAVIOUR + REBUILD | Native PO route/redirect, ASIN/date inputs/calendar, 6M/12M/Today, Search/Enter, result columns and Full Portal. Authenticated native PO search URL/results. |
| `Screenshot_Mode.user.js` | PRESERVE BEHAVIOUR + REBUILD | Ctrl+Q hides/restores V4 controls, version UI and owned styles without changing native state; include PO Portal. V4 ownership markers only. |
| `BWU2_Actions_Core.lib.js` | SHARE LATER; DO NOT MIGRATE implementation | Consider exact response/identity helpers and genuinely shared MoveContainer/Unbind responsibilities after their workflow contracts are proven. No V2 library, lock or session dependency. |
| `BWU2_Fleet_Core.lib.js` | SHARE LATER; DO NOT MIGRATE implementation | Small proven needs such as version marking, owned UI/style markers and evidence emission may justify helpers. Do not rebuild a universal fleet framework first. |
| `Diagnostics/Amazon_ASIN_Variation_Finder_TEST.user.js` | DO NOT MIGRATE | Previously excluded diagnostic. Retain its false-exact-match lesson, not an operational V4 tool. |

Also **DO NOT MIGRATE**: removed Sideline/ISS Restructure, V3 installers/architecture/state/CSS, old RPC/storage compatibility, expiring ownership leases, coexistence machinery and obsolete FC-Lite general sections. Historical tests may supply cases; they do not define V4 implementation.

## Dependencies and safest rebuild order

Each arrow below is a dependency, not a UI relocation. Native authentication is always a real external dependency; V2/V3 installation never is.

1. **OBS contract/collector:** establish version, owned-UI/style and per-operation evidence boundaries; no universal workflow engine.
2. **FCR read capability:** exact identities, pagination, malformed/auth failures and measurement renewal. Implement only the reads required by the next consumer.
3. **FCR Master**, then **Tote Audit**, then **Bin Check**, then **FNSKU Mapping**: finish and push each consumer independently. Add read capabilities only when needed.
4. **Hierarchy Bind + Unbind:** one logically coupled ownership/recovery unit, preserving both native workflows.
5. **Dropzone**, then **Stow:** establish proven MoveContainer validation before reusing it; hierarchy precedes Stow Unbind. Printing follows confirmed movement only.
6. **Sideline Queue + Lazy:** one coupled native workflow unit; scanner, preflight dates, Stop and Predicant are acceptance requirements from the outset.
7. **AFT:** Edit, Move and FCSKU Flip contracts first; use intermediate pushed checkpoints if this installer spans more than a small unit.
8. **ISS:** only after its native Sideline/AFT behaviours are verified offline. Decide worker/transport internals from authentication and runtime evidence while preserving the FCR interface.
9. **RIVER**, **SIM**, **Carton**, **Calm**, **PO Portal**, then **Screenshot Mode**: one pushed unit each. RIVER consumes verified exact FCR data; Screenshot consumes explicit V4 ownership markers.
10. **Live acceptance:** V2/V3 disabled, native auth/markup, refresh/repeated use, long idle and longer batches. Apply useful shared abstractions only after real overlap is demonstrated.

## Mandatory regression requirements

| Evidence | V4 acceptance requirement |
|---|---|
| Audit F01/F13: hierarchy reload/competing owners | Saved queued/done/attention rows survive; one mutation owner per workflow/resource; Pause prevents the next submit. |
| F02/F03: Dropzone replay/false Move confirmation | Submitted uncertainty survives Pause/Clear/reload and cannot be replayed by Run; login HTML, redirects, pending or contradictory responses never prove movement. Validate each endpoint's actual contract. |
| F04/F05/F09: Sideline/AFT/ISS uncertainty and ownership | Explicit SUBMITTED/CONFIRMED/UNKNOWN; uncertain rows remain visibly reviewable and non-runnable; ownership lasts through the actual batch. Stop cannot erase uncertain outcomes. |
| F06/F07/F16: incomplete inventory/wrong mapping/title | Audit requires complete inventory; exact FNSKU/FCSKU identity, honest partial regions; a printed title must belong to the printed code/verified alias. |
| F08: employee identity | Current authenticated application identity, no stale cache/header-label guess. Refuse mutation when identity is unresolved/conflicting. |
| F10/F12: Carton readiness/RIVER cancellation | Ready barcode + count before one completion; Clear cancels later form writes and Next actions. |
| F14/F15: mutation evidence/Screenshot route | GM/native mutations yield one useful lifecycle transcript without token leakage or forwarded duplicates; read-only POST is not a mutation; Ctrl+Q works on PO Portal. |
| V3 review: scanner and Predicant | `123START` and source/destination rescans are controls, never item rows; known rejected clears allow another deliberate destination scan under one recovery owner; UNKNOWN never auto-retries; safe retries get fresh request identities. |
| V3 review: UX/recovery reductions | All proven SIM/Tote controls and Lazy expiry sequence retained; AFT reload distinguishes unsubmitted from submitted work and exposes all uncertainty. No private invisible recovery list. |
| Cross-workflow lifecycle | Clean start/disposal, repeated use, reload, Stop/Clear, long idle and no needless background traffic. No V2/V3 globals, storage, events, CSS or libraries. |

## Evidence limits and next gate

Basis: all 22 current V2 source entries and relevant current changes; Sep 30 audit F01–F16; four Oct 5 V2 OBS exports (overlapping snapshots); the pinned V3 review and isolated failure reproductions; recovered explicit scope decisions. Current V2 source alone does not prove every latest revision works live. V3 tests are regression knowledge, not proof of V4.

This baseline does not select a fleet architecture or assert test readiness. Each unit must first record **PRESERVE / FAILURES / STATE / SUCCESS / UNKNOWN / RESET / DEPENDENCIES**, resolve evidence gaps, then implement and verify. Ordinary engineering and restoring proven behaviour are authorised; material user-facing changes require explicit approval.

Before another unit starts: validate, commit, push `v4-cleanroom`, verify the remote SHA and report it. Push intermediate checkpoints for large/risky/uncertain work. Never force-push or rewrite recovery history. Next unit: OBS behaviour contract.
