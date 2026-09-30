# BWU2 Tampermonkey V3

Clean-room rebuild of the BWU2 userscript fleet.

## Branch
Development happens on `v3-rebuild`. V2 `main` remains the rollback/reference until V3 features are individually proven.

## Hard rules
- Do not port the retired old Sideline.
- Do not port `Diagnostics/Amazon_ASIN_Variation_Finder_TEST.user.js`.
- Sideline REBUILD is the behavioral baseline for V3 Sideline.
- Do not delete or disable V2 working paths merely because V3 exists.
- One installed userscript per application/domain family, not one giant mega-script.
- Source is modular; production userscripts are bundled/self-contained.
- Backend/API state is authoritative where proven; DOM automation remains only where required.
- No blind replay after a submitted mutation with unknown outcome.
- Automatic employee identity must come from current authenticated context, never free-text/manual identity entry.
- No focus stealing or visible worker popup.
- Ctrl+Q Screenshot Mode is a shared V3 capability.
- Strong accessible state colors/labels; color is never the only signal.

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
