# BWU2 Tampermonkey V3 — Ground-up rebuild

Branch: `v3-groundup`

V3 is a clean rewrite. V2 is the behavioural specification; prior V3 branches are evidence only.

## Non-negotiables

- Preserve familiar V2 user workflows unless a user-facing change is explicitly approved.
- Native pages stay native when that is simpler.
- FCResearch is a toolbox, not the home of every workflow.
- ISS Console owns Edit / Move / Sideline / FCSKU as a dedicated console.
- Native AFT, Sideline, Hierarchy and MoveContainer remain usable directly.
- Shared behaviour has one canonical engine.
- Submitted mutations finish CONFIRMED, REJECTED or UNKNOWN.
- UNKNOWN never auto-retries.
- Identity must come from authenticated evidence, never free text.
- Safety-relevant FCR inventory must be complete or fail.
- Idle scripts do nearly nothing.
- OBS is operation-level and sanitized; no giant network sniffer.
- No runtime @require and no V2 compatibility layer.

## Installed scripts

1. V3 | BWU2 FCResearch
2. V3 | BWU2 ISS Console
3. V3 | BWU2 AFT Tools
4. V3 | BWU2 Sideline
5. V3 | BWU2 Hierarchy
6. V3 | BWU2 MoveContainer
7. V3 | BWU2 RIVER Assistant
8. V3 | BWU2 FNSKU Mapping
9. V3 | BWU2 PO Portal
10. V3 | BWU2 Carton PrEditor
11. V3 | BWU2 Calm Code
12. V3 | BWU2 SIM Toolbar
13. V3 | BWU2 OBS + Screenshot

Source modules are shared at build time. Every generated userscript is self-contained.
