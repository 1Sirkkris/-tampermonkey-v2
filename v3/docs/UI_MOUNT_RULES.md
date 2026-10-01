# V3 UI / Mount Rules

## Principle
The native Amazon page is an **input/data surface**, not the layout framework for V3.

## Rules
1. One suite = one top-level mount root.
2. The suite root is appended once to `document.body`.
3. V3 suite UI uses an open Shadow DOM to isolate styles/IDs from native page CSS and React churn.
4. Production suites prefer `@run-at document-body` when early interception is not genuinely required.
5. Feature modules render into suite-owned slots. They do not independently append floating panels to `document.body`.
6. Feature modules do not create bootstrap MutationObservers to find their own mount point.
7. Native-DOM observers are allowed only for a named native state dependency, with:
   - narrow root,
   - narrow mutation options,
   - explicit owner,
   - explicit disconnect/teardown.
8. No unbounded `setInterval` attachment polling.
9. Route changes are handled by one suite router.
10. All suite listeners/observers/timers belong to one disposable lifecycle.
11. If a native inline control is genuinely superior to the suite shell, its placement contract must be documented and tested. Inline injection is the exception, not the default.
12. UI state always uses text/icon + color; color alone is never semantic.

## Why
V2 accumulated multiple independent attachment/reconciliation strategies across FCResearch, ISS, Sideline, Bin Check, Stow and RIVER. V3 removes that class of complexity instead of standardising it.
