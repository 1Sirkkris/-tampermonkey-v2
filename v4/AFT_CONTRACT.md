# AFT native contract

PRESERVE: V2 0.9.46 native AFT host and left-side Edit EACH/SKU/Date, Move EACH/ALL/QTY, FCSKU Flip helpers; top-right seven mode choices; source/disposition controls, structured S/P/U quantities, scanner/Enter/123START, queue rows, Stop/Clear/minimise, expiration helpers.

FAILURES: F04/F05/F09 uncertain action replay, stale workflow IDs, mode/submission conflicts; V2 recovery loops are not permission to replay UNKNOWN. V3 is not a code base.

STATE: native objectId/instructionId, one browser owner for native /action batch, durable rows and explicit submitted outcomes. Persist before each inventory-changing Confirm/destination or date removal. Status polling only while an explicit native operation is PROCESSING, bounded and cancelled appropriately. Stop prevents later inventory submissions but settles an accepted one. Clear/reload retain unresolved state.

SUCCESS: exact native workflow identity, valid READY/COMPLETE status and explicit successful native workflow state. Move additionally requires exact complete source/destination quantity readback; HTTP 200, READY or disappearance alone is not movement proof. Inventory states and opaque source-radio values come from exact native labels. Quantity/owner ambiguity fails closed.

UNKNOWN: lost/malformed/redirected/status timeout or mismatched workflow; no automatic replay, no automatic /end that could erase uncertainty. Date removal and replacement are distinct mutations. Production acceptance requires native schema, scanner and authenticated readback evidence.

RESET: known completed/rejected work may end and acquire a different native workflow ID. UNKNOWN blocks mode changes and later runs until native outcome is reviewed. Ordinary native UI remains at its proven host. All implementations bundled; OBS optional; no V2/V3 globals/storage/CSS imports.

0.1.1 restores final V2 state/disposition button groups and SKU route restrictions/defaults, four individual code/native-date rows with grow/Add, raw full-response quantity matching plus event-driven native rendered fallback. Known backend ERRORED and explicit native failed-consumer-type state recover through at most three fresh-workflow attempts with quantity recheck; uncertainty never recovers automatically. Completed mutation evidence is retained separately from later workflow cleanup/preparation uncertainty, so a lost Done/end does not rewrite a prior confirmed operation transcript. Native generated/date/move/recovery/quantity fixtures pass; deployed schemas, expiry and FCSKU multi-run acceptance remain live gates.

0.1.3 adds scanner caret/newline and destination rescan start parity. Safety boundary: one Confirm is sent for the pending native confirmation. If the page still requests another confirmation, its prior mutation outcome is UNKNOWN and automated Confirm/end/replay stop. V2 repeated up to ten confirmations; additional legitimate native stages need captured contract evidence before they can be automated safely. This is an explicit no-unknown-repeat correction, not live proof.
