# BWU2 Tampermonkey V3

Clean-room rebuild of the BWU2 userscript fleet.

## Branch
Development happens on `v3-rebuild`. V2 `main` remains the rollback/reference until V3 features are individually proven.

## Primary goal
V3 is **not** a merge, cleanup pass, or port of V2 source.

V2 code, OBS logs, chat history, handoffs and live behavior are evidence used to understand:
- required workflows,
- proven backend/API contracts,
- user-facing behavior worth preserving,
- historical failure modes,
- compatibility requirements that are still real.

V3 implementations are then written fresh from those requirements.

A V2 workaround, helper, selector, retry loop, timer, compatibility branch, duplicated utility, storage key, UI fragment or API wrapper does **not** survive merely because it already exists. Every carried behavior must justify itself.

## Hard rules
- Do not port the retired old Sideline.
- Do not port standalone V2 Unbind.
- Do not port `Diagnostics/Amazon_ASIN_Variation_Finder_TEST.user.js`.
- Sideline REBUILD is the behavioral baseline for V3 Sideline, but its source is still reviewed rather than blindly copied.
- V3 Hierarchy is one fresh Bind/Unbind implementation built from proven behavior/contracts.
- Do not delete or disable V2 working paths merely because V3 exists.
- One installed userscript per application/domain family, not one giant mega-script.
- Source is modular; production userscripts are bundled/self-contained.
- Backend/API state is authoritative where proven; DOM automation remains only where required.
- No blind replay after a submitted mutation with unknown outcome.
- Automatic employee identity must come from current authenticated context, never free-text/manual identity entry.
- No focus stealing or visible worker popup.
- Ctrl+Q Screenshot Mode is a shared V3 capability.
- Strong accessible state colors/labels; color is never the only signal.
- Prefer deleting historical complexity over recreating it.
- Compatibility code must name the live compatibility need it serves; otherwise it stays in V2.
- Every timer, observer, retry loop and cache must have a bounded lifecycle and an explicit owner.

## Target installs
1. BWU2 FCResearch Suite
2. BWU2 AFT Suite
3. BWU2 Hierarchy Suite
4. BWU2 MoveApp Suite
5. BWU2 FNSKU Mapping
6. BWU2 PO Portal
7. BWU2 Utilities
8. BWU2 OBS / Diagnostics (design pending)

The target is fewer installed scripts, while keeping source modules small and auditable.

## Build principle
`src/` contains human-maintainable modules. `dist/` contains generated installable userscripts. Production behavior should not depend on mutable runtime `@require` files from `main` unless a dependency is deliberately immutable/version-pinned.

## Migration
See `MIGRATION_MATRIX.md`.

## Architecture
See `ARCHITECTURE.md`.


## Runtime independence
V3 must run correctly with every V2 userscript disabled.

V3 production code must not:
- detect V2 scripts and branch around them,
- depend on V2 globals, storage, DOM markers, events or runtime libraries,
- load V2 files through `@require`,
- preserve V2 attachment hacks solely for coexistence,
- delay/disable V3 behavior because V2 may be present.

V2 may be consulted during development as evidence/reference only. Coexistence is not an architectural requirement.
