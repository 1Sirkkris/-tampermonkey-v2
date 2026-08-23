# Tampermonkey V2 — GOD MODE

## Role

This repository is the source of truth for the Tampermonkey V2 script fleet.

Architecture:
- OVERSEER = main brain / coordinator / work-access chat
- LIVE EVIDENCE = real-site capture and observations
- Research chats = investigate unknowns
- GitHub repo = source of truth
- `AGENTS.md` = canonical coding rules
- Codex local `Audit repository architecture` = actual repo coder

## Mode 1 — Code Cleanup / Optimization GOD MODE

FUNCTION FIRST. SPEED SECOND. BLOAT DEAD.

For existing code:
1. Preserve working behaviour first.
2. Improve real runtime performance.
3. Remove dead code, duplicate logic, obsolete fallbacks, stale experiments and debug bloat.
4. Fix root causes, not layered band-aids.
5. Audit startup, DOM scans, observers, timers, listeners, requests, parsing, state, async/races, cancellation, memory and repeated work.
6. Preserve external contracts unless change is proven necessary:
   - metadata
   - URLs
   - endpoints
   - payloads
   - storage keys
   - selectors
   - shortcuts
   - labels
   - IDs/classes
   - persisted preferences
   - workflow order
7. Keep helpers that reduce duplication or isolate fragile behaviour.
8. Do not chase line count.
9. No optimization theatre.
10. If something is ugly but reliable and changing it gives almost no benefit: leave it alone.
11. Regression check every changed workflow as `Trigger → Action → Result`.
12. If static review cannot prove behaviour, report exactly: `Regression: Live validation needed.`

## Mode 2 — Workflow / Backend GOD MODE

BROAD DISCOVERY FIRST. DO NOT TUNNEL VISION.

Challenge the architecture itself.

Search for:
- UI automation → direct API
- unnecessary or duplicate API calls
- backend data already available earlier
- serial work → safe concurrency/batching
- repeated page loads/navigation
- DOM scraping that can be replaced
- polling/observers/listeners that can disappear
- duplicate auth/session/request logic
- shared caches/data cores
- duplicated parsing/transforms
- cross-script duplicated work
- lazy/conditional execution
- cancellation/early-stop opportunities
- whole subsystems that can be removed

Internally rank discoveries:
- GOD
- HIGH
- MEDIUM
- LOW
- NEEDS MEASUREMENT

Preferred workflow:
`Discovery → measure waste → choose architecture → implement → Cleanup GOD Mode → validate`

Goal: make the helper scripts materially faster, easier and more reliable than the original tools they assist or replace.

## Live Evidence

Never guess unknown internal API contracts.

Use evidence capture when needed.

Logging should maximize useful workflow/backend/performance evidence while excluding:
- auth
- cookies
- tokens
- credentials
- unnecessary sensitive identifiers

## Repository Rules

- GitHub is the source of truth.
- `AGENTS.md` is the canonical rulebook.
- Inspect relevant shared code and neighbouring scripts before changing a script.
- Work with the existing architecture before inventing replacements.
- Do not create duplicate implementations without a proven reason.
- Prefer shared infrastructure when multiple scripts perform the same work.
- Preserve script independence where sharing would reduce reliability.
- Do not silently change user-visible behaviour.
- Do not remove working features merely because they appear unused unless evidence proves they are dead.
- Do not manually patch around a bug when the underlying cause can reasonably be fixed.
- Keep changes scoped and reviewable.

## Version Authority + GitHub Sync

Default rule for normal fleet scripts:

`revise → validate locally/static-contract check → deliver → write current version to GitHub`

- Any newly delivered fleet-script version becomes the current approved version by default.
- The user does not need to separately confirm that each delivered version is validated/current.
- Only an explicit user rollback/revert/don't-keep instruction invalidates a newly delivered version.
- Once a normal fleet-script revision is delivered, update its corresponding GitHub source as part of the same task so Tampermonkey can pull the current version.
- Do not make the user remember to request source synchronization.
- Diagnostic/probe/test-only scripts are excluded from automatic promotion unless explicitly promoted into the normal fleet.
- A `TEST` label in a long-lived fleet script name does not by itself block synchronization; intent matters. Only genuinely experimental/diagnostic candidates stay local.
- Do not create branches, merge, delete files, force-update refs, or change unrelated repository content under this standing approval.
- Preserve rollback by keeping normal Git history/version increments.
- If GitHub synchronization is blocked by environment/tooling, say so explicitly in the completion note rather than silently leaving source stale.

End-of-day reporting should be compact and user-facing:

`Script | Start version | End-of-day version | Revisions today`

Track only scripts touched that day unless the user asks for a full-fleet report.

## External Contract Protection

Do not change without a proven reason:
- userscript metadata
- match/include URLs
- endpoints
- request payloads
- storage keys
- DOM selectors
- keyboard shortcuts
- labels
- IDs/classes
- persisted preferences
- workflow order

## Work Mode Safety

Never create or send anything to Work Mode automatically.

Before any Work Mode handoff say exactly:

`REQUESTING TO SEND TO WORK MODE - WILL CREATE NEW CHAT`

Then wait for user approval.

Do not create duplicate Codex/Work threads. Use the existing architecture whenever possible.

## Work-Laptop Pack

Branch: `work-laptop-pack`

Current pack:
- `01_Sideline.txt`
- `02_AFT_Edit-SKU-Move.txt`
- `03_FCR_Data_Core.txt`
- `04_FCResearch_Master.txt`
- `05_FC-Lite.txt`
- `06_Stow_Andons.txt`
- `07_Bin_Check_Overlay.txt`
- `08_Dropzone_Queue.txt`
- `09_LIVE_EVIDENCE_CAPTURE_v0.3.0.txt`
- `WORK_LAPTOP_INSTALL.txt`

This branch doubles as the install/update source for the work-laptop fleet. Normal approved fleet-script revisions should therefore be synchronized here automatically under the Version Authority + GitHub Sync rule above.

Do not promote genuinely experimental/diagnostic candidates into the work-laptop fleet unless explicitly approved.
