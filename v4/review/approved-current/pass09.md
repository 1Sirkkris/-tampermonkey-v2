# Pass 9 — Cartonpreditor rendered Complete

Problem: Cartonpreditor could click Complete hidden by its own CSS or an ancestor, even though it was present in the DOM.
Correction: canonical readiness checks real rendered geometry/visibility, then rechecks it after ownership. Existing observer follows relevant class/style/hidden changes. The same small rendered-control function now supplies RIVER's already-verified readiness, eliminating duplicate checks; no CSS override or delay added.
Loose example: Complete still exists on the page but a native panel hides it while changing carton. V4 waits for the visible ready control rather than clicking the hidden one.
Verification: all seven new source/generated failure cases reproduced. 29 Carton/RIVER source/installer fixtures now pass, including hidden control/ancestors, late-owner hide, normal readiness, exactly one click and UNKNOWN retention. Carton 0.1.2 and affected RIVER 0.1.3 built. jsdom geometry models browser layout; actual native visual/control acceptance remains pending.
Status: offline verified. Default ON and native placement/workflow preserved; no live carton operation; publication held.
