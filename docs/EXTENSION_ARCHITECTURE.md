# Future extension architecture

## Decision

Do not package the current branch into an extension yet. Safe packaging needs live confirmation of internal host permissions, page-context versus isolated-world behavior, authentication flow, background lifetime, and the deferred API contracts. Current userscripts remain independently installable and are the rollback boundary.

Chrome Manifest V3 background work runs in an extension service worker, while content scripts run in web pages with an isolated execution environment. Firefox WebExtensions use the same content-script concept but retain browser-specific background and manifest details. Re-check both official platforms when implementation starts: [Chrome extension service workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers), [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Firefox background manifest key](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background), and [Firefox content scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts).

## Target layers

```text
extension package
├── manifests: Chrome / Firefox variants
├── background
│   └── shared Data Core, cache ownership, request dedupe, diagnostics routing
├── shared
│   ├── contract constants and message schemas
│   ├── pure parsing/normalization
│   └── bounded cache primitives
├── content
│   ├── FCResearch Master
│   ├── FC-Lite
│   ├── Stow
│   ├── Bin Overlay
│   ├── Sideline
│   ├── AFT
│   └── Dropzone
└── diagnostics (optional development build only)
```

Each content module owns its host matching, init guard, DOM selectors, shortcuts, labels, lifecycle, and workflow state. The background layer must never become a monolithic UI controller.

## Script boundaries

| Area | Initial extension treatment | Later shared opportunity |
|---|---|---|
| FCR Data Core | Background candidate after cache/auth evidence | Canonical product, inventory, history, Hazmat, and bin cache |
| FCResearch Master | Independent FCResearch content module | Shared Core client and pure label/parsing helpers |
| FC-Lite | Independent/optional FCResearch content module | Shared Core client; retain standalone hash route |
| Stow | Independent FCResearch content module | Shared Core client; move/print adapters remain local |
| Bin Overlay | Independent FCResearch content module | Hierarchy cache only after live response/rate evidence |
| Sideline | Independent content module | Shared message types and pure response reason parsing |
| AFT | Independent QualityTools content module | Shared workflow executor only after quantity/objectId live validation |
| Dropzone | Standalone until renderer/state workflow is complete | Shared move request adapter after live state validation |
| Super Tracer / unified capture | Separate opt-in development build | Shared redaction and performance aggregation |

## Compatibility bridge

The first extension build must preserve these page-facing interfaces for userscript coexistence and rollback:

- `fcr-data-core:request`
- `fcr-data-core:response`
- `fcr-data-core:ready`
- `fcr-usage:event`
- `fcrm:size-resolved`
- `window.BWU2Trace` / `__BWU2_TRACE__` for optional diagnostics

Use a versioned extension message schema behind the bridge. Validate payloads at the boundary and keep page events until every current consumer has migrated.

## Safe migration order

1. Move only pure parsers/normalizers already covered by fixture replay tests into a shared source module. Keep generated userscript output byte/contract equivalent.
2. Build a test-only manifest with one content module and no workflow mutation. Verify host permissions and DOM/page-world behavior in both browsers.
3. Add the event bridge and prove userscript/extension coexistence.
4. Move FCR Data Core cache ownership only after measuring hit rates, stale-data tolerance, service-worker suspension, and storage limits.
5. Add content modules one at a time with per-script rollback.
6. Keep diagnostics out of release builds unless explicitly enabled.

## Evidence required before implementation

- Which requests require page credentials, page-world JavaScript objects, privileged cross-origin access, or current `GM_xmlhttpRequest` grants.
- Whether internal CSP blocks page-script injection or extension resources.
- Actual background suspension/restart behavior during long AFT/Sideline workflows.
- Cache size, TTL correctness, invalidation events, and cross-tab consistency.
- Exact deferred close-container, AFT quantity, Dropzone state, and Bin hierarchy contracts.
- Browser policy/manifest differences at implementation time.

No manifest or runtime extension scaffold is committed now because an apparently installable but unvalidated package would create false confidence and a second behavior surface.
