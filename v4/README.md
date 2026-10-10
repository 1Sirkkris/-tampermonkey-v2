# Tampermonkey V4 — staged testing candidates

Active branch: **v4-cleanroom**. Resume from [CHECKPOINT](CHECKPOINT.md), then read [AGENTS](AGENTS.md), [BRIEF](BRIEF.txt) and [BASELINE](BASELINE.md). The enclosing checkpoint commit is its SHA. V2 root files/main and frozen V3 are unchanged.

**18 operational installers are built: 14 implementations COMPLETE offline, four PARTIAL.** A nineteenth installer is the manual read-only native capture diagnostic. No BASELINE workflow is NOT BUILT. Every current installer is OFFLINE VERIFIED; no current suite is LIVE MUTATION VERIFIED. These are staged test candidates, with the scope below, not production replacement acceptance.

The October 6 user sample supports observed FCR native inventory/empty Product/Pandash/cached MADCAT reads on Master 0.1.3. It does not verify the whole current Master 0.1.5, cold/expired auth, every native control or operational mutations.

## Installers and exact readiness

Click a script name to open its Tampermonkey installer. Disable corresponding V2/V3 scripts during V4 testing. Each installer bundles its own required V4 capabilities; OBS is optional. ISS and Stow include their own native-origin workers and do not require another helper installer. Authentication, native applications, Web Locks and optional local printer service remain real external dependencies.

| Script / install link | Version | Implementation | Readiness | Offline fixtures | Remaining issue |
|---|---|---|---|---|---|
| [OBS](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/OBS.user.js) | 0.1.3 | COMPLETE | READY FOR READ-ONLY TEST | 28 | Tampermonkey storage/export and long-session acceptance |
| [FCR Master](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FCResearch_Master.user.js) | 0.1.5 | COMPLETE | READY FOR READ-ONLY TEST | 54 | Native A/L/date/filter/keyboard/navigation; cold/expired MADCAT auth; printing separately approved |
| [Tote Audit / FC Lite](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FC_Lite.user.js) | 0.1.1 | COMPLETE | OFFLINE VERIFIED — LIVE GATE PENDING | 9 + 2 shared barcode | Native barcode schemas, scanner timing, discrepancies/auth and optional print |
| [Bin Check](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Bin_Check_Overlay.user.js) | 0.1.1 | COMPLETE | OFFLINE VERIFIED — LIVE GATE PENDING | 7 | Native filtered rows, hierarchy floor and visual placement; optional print |
| [FNSKU Mapping](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FNSKU_Mapping_Lookup.user.js) | 0.1.0 | COMPLETE | OFFLINE VERIFIED — LIVE GATE PENDING | 10 | Regional native auth/results/pagination and honest partial regions |
| [Bind Hierarchy](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Bind_Hierarchy_Queue.user.js) | 0.1.2 | COMPLETE | OFFLINE VERIFIED — LIVE GATE PENDING | 18 shared hierarchy | Native seed/template/session/identity/acknowledgement; approved operation |
| [Unbind Hierarchy](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Unbind_Hierarchy_Queue.user.js) | 0.1.2 | COMPLETE | OFFLINE VERIFIED — LIVE GATE PENDING | 18 shared hierarchy | Native identity/acknowledgement and reload recovery; approved operation |
| [Dropzone Queue](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Dropzone_Selector_Queue.user.js) | 0.1.3 | PARTIAL | PARTIAL | 18 | Empty-container location proof absent; nonempty native Enter/queue/identity/readback live gate |
| [Stow Andons](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Stow_Andons_Helper.user.js) | 0.1.1 | PARTIAL | PARTIAL | 9 | Empty-container movement withheld; native frames/auth/locks/readback and optional print |
| [Sideline Queue + Lazy](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Sideline_Queue_Lazy.user.js) | 0.1.3 | COMPLETE | OFFLINE VERIFIED — LIVE GATE PENDING | 27 | Native scanner/preflight/hazards/QTY/date/Predicant/two-stage Stop and longer batches |
| [AFT Edit / Move / FCSKU Flip](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/AFT_Edit_SKU_Move.user.js) | 0.1.4 | PARTIAL | PARTIAL | 24 | Additional legitimate native confirmation stages need captured semantics; native modes/quantity/date/auth acceptance |
| [ISS Console](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/ISS_Console.user.js) | 0.1.4 | PARTIAL | PARTIAL | 18 | Same additional AFT confirmation gap; native frames/auth/locks/scanners/date/Predicant and visual acceptance |
| [RIVER Ticket Assistant](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/FCResearch_RIVER_Ticket_Assistant.user.js) | 0.1.0 | COMPLETE | OFFLINE VERIFIED — LIVE GATE PENDING | 6 | Native page-info/forms/quantity/handoff/Run cancellation; final gates manual |
| [SIM Markdown Toolbar](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/SIM_Markdown_Toolbar.user.js) | 0.1.0 | COMPLETE | OFFLINE VERIFIED — LIVE GATE PENDING | 9 | Native editors/caret/presets, attachment auth/popup/download; draft-only first |
| [Carton PrEditor](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Carton_PrEditor.user.js) | 0.1.1 | COMPLETE | OFFLINE VERIFIED — LIVE GATE PENDING | 6 | Native count/barcode/Complete/audio. Auto-complete defaults ON as V2; approved installation/test case |
| [Calm Code](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Calm_Code.user.js) | 0.1.0 | COMPLETE | OFFLINE VERIFIED — LIVE GATE PENDING | 3 | Native labor form events/submission/backend outcome; approved role case |
| [PO Portal Lite](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/PO_Portal_Lite.user.js) | 0.1.0 | COMPLETE | READY FOR READ-ONLY TEST | 3 | Native dates/calendar/result columns/Full Portal/navigation |
| [Screenshot Mode](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/Screenshot_Mode.user.js) | 0.1.0 | COMPLETE | READY FOR READ-ONLY TEST | 2 | Actual visual/keyboard acceptance across supported pages including PO |
| [Native contract capture](https://raw.githubusercontent.com/1Sirkkris/-tampermonkey-v2/v4-cleanroom/v4/diagnostics/FCR_Native_Capture.user.js) | 0.1.3 | COMPLETE | READY FOR READ-ONLY TEST | 19 | Manual snapshots + opt-in passive native response trace; native transport-world acceptance/text review; not outcome/auth proof |

COMPLETE describes the implemented offline contract, not complete live acceptance. Four PARTIAL labels make the unimplemented parity scope explicit. No candidate has been promoted solely because fixtures pass. Fixture counts overlap shared capabilities and must not be summed as independent tests.

## Verified evidence and reproducible commands

Current automated result: **346 passed / 0 failed**, with no skipped/cancelled tests. Deterministic source/installer match, 19 installer metadata/version/update/download/duplicate identity/independence checks, 69 source syntax checks and whitespace pass.

The test command uses four concurrent test files for bounded runner resource use. All 346 cases completed with zero skipped/cancelled cases; an initial unrestricted run stopped without a complete result and is not claimed as passing.

Shared checks include 3 actual build recovery fixtures, 30 FCR read fixtures, 21 enrichment, 16 auth, 4 watermark and 2 generated suite integration fixtures. Actual separate installer bundles share one truthful footer across FCR/ISS navigation, Ctrl+Q and BFCache, with zero script-owned idle API requests in those fixtures. No deployed idle performance claim is implied.

The accessible October 6 native capture also passes the actual captured AUI/jQuery 1.6.4/renderer/DataTables 1.9.4/advancedFilter harness on current source: partial retry, three deliberate replays, totals/sort/scroll, working native filter, one nav/control, zero leaked DataTables instances and settled native Ajax. Only selected captured native modules and synthetic read responses run offline; no external/native requests or operations.

Run from v4/:

~~~sh
npm ci --ignore-scripts
npm run build
npm test
npm run check
git diff --check
# Optional actual captured native-code harness; raw capture stays outside Git.
node verify-native-capture.mjs /path/to/FCR_native_capture.json
~~~

Existing contracts and validation files remain authoritative. The readable V2 source, Sep 30 F01–F16 audit, V3 readiness/failure evidence and supplied October 6 captures/logs informed the contracts; unavailable conversations are not claimed reviewed. Raw operational captures/credentials are not committed.

## Staged user testing order

Use one test case at a time with V2/V3 counterparts disabled. Confirm the footer lists only current active V4 scripts and actual installed versions. Keep native controls and scanner focus visible. Test-candidate labels do not authorise live operations or production rollout.

| Stage | Candidates | Test scope and expected evidence |
|---|---|---|
| 1 — read-only | OBS, FCR Master, PO Portal, Screenshot | Native Product + complete Inventory; truly empty Product; native pagination/sort/filter/date/A/L/keyboard/navigation/retry; Pandash and cached/cold/expired MADCAT; OBS export/Clear; PO calendar/6M/12M/Today/Search/Full Portal; Ctrl+Q restore native focus/styles/footer and BFCache. Leave print controls unused. |
| 2 — read/draft | Tote, Bin, FNSKU, SIM, RIVER FCR capture | Container + repeated physical scans, all twelve Tote columns/quantities/discrepancies/reset/pending scans; Bin snapshots current native filtered rows and resolves floor honestly; regional exact mapping/partial results; SIM selection/caret/table/image/presets CRUD/import/export and attachments in an unsent draft; RIVER exact FCR quantity/PO/date provenance. Keep printing, ticket Run/Next/final submission and SIM publishing out of this stage. |
| 3 — approved native operations | Bind/Unbind, Sideline, AFT, then ISS | Start with one explicit approved container/item/quantity. Compare native outcome and OBS lifecycle; test scanner source/destination/123START, quantities/duplicates/expiry/preflight/hazards, rejected Predicant destination recovery, native modes/Flip and two-stage Stop. Verify standalone native workflows before ISS framing/date/three-area integration. Pause at any extra AFT confirmation/UNKNOWN; no automatic replay. |
| 4 — approved movement | Dropzone, then Stow | Nonempty exact container with native location proof, one chosen destination; queue/native Enter share one submission owner. Confirm complete readback, Pause/Clear/reload retention and Stow workers/Unbind/print-after-confirmed-move. Empty containers remain blocked until the missing contract is implemented. |
| 5 — approved side effects | Printing, Carton, Calm, RIVER native steps | Verify exact code/title/quantity and physical printer output; approved ready Carton barcode/count/audio; approved Calm role form/native backend result; RIVER Run/Stop and final manual gates. Carton ON default can complete a ready carton as soon as installed. Production rollout remains a separate decision. |

For Stop/Clear/reload and timeout cases, first use unsent/read-only work; deliberate interruption of a submitted live operation needs its own approved case and recovery plan. An unavailable worker/auth/session must fail visibly and never count as a completed operation.

Record per case: Sydney date/time, current installer versions, route/mode, non-sensitive case alias, expected native behaviour, observed result, whether a request was submitted, exact SUBMITTED/CONFIRMED/REJECTED/UNKNOWN state, native readback or physical output, and OBS export/error evidence. Store raw evidence privately and redact before sharing; never commit live identifiers, credentials or payloads. Unit/fixture output cannot substitute for that case record.

UNKNOWN is retained and non-runnable. Stop, Clear, refresh or reload must preserve it; do not clear browser storage or re-add the operation to make the queue complete. Verify the real native outcome first. No mutation is automatically retried to resolve uncertainty.

## Historical regression acceptance matrix

| Cases | User acceptance requirement |
|---|---|
| F01 / F13 | Bind/Unbind queued and recovery rows survive refresh; one native owner; competing tabs/scripts cannot submit or overwrite the active owner's ledger. |
| F02 | Dropzone repeated Run/Enter/Pause/Clear/reload never replays SUBMITTED/UNKNOWN rows; native and queue paths share ownership. |
| F03 | HTTP 200 alone never proves movement; exact complete native destination readback required; stale/mixed/empty/no-location/auth/pending responses stay rejected or UNKNOWN. |
| F04 | Sideline loss of a submitted result retains UNKNOWN. Only known rejected Predicant close/move permits a deliberate recovery with a fresh operation identity. |
| F05 | AFT visible quarantine survives Stop/Clear/reload; queued state is distinct from submitted state; a continuing Confirm page cannot trigger repeated unknown confirmations. |
| F06 | FCR/Tote require complete validated inventory, correct totals and native continuation controls; partial results visibly remain partial. |
| F07 | Mapping identity is exact; conflicting aliases or unavailable regions never become a complete guessed result. |
| F08 | Current native employee identity is coherent; missing/conflicting/cached/header-label guesses cannot authorise mutation. |
| F09 | ISS owner lasts through the actual native promise; Stop/date cancellation/late health/lost frames cannot hand off more work or hide uncertainty. |
| F10 | Carton barcode/count/control readiness is rechecked after owner acquisition; count 1, stale/hidden/detached/disabled controls and reload do not cause duplicate Complete. |
| F11 | Excluded ASIN variation diagnostic remains excluded; retain its false-exact-match lesson only. |
| F12 | RIVER Stop/Clear prevents later field writes and Next after awaited native controls; ambiguous quantity stays manual. |
| F14 | Each accepted mutation has one useful sanitized lifecycle transcript including GM/native owners; OBS optional; successful read-only POST is never movement proof. |
| F15 | Ctrl+Q hides/restores V4 UI/styles/footer on all supported routes including PO without changing native values/focus. |
| F16 | Printed code, verified alias, title and quantity belong together; physical output checked independently, no automatic print retry. |

Also check native scanner speed, source/destination rescans, duplicate quantities, expiry date cancellation, Lazy defaults, longer batches and long idle. ISS 0.1.3 must show the grey loading wheel immediately on a valid Predicant destination rescan, ignore repeated recovery scans, reopen after known rejection and clear feedback on Stop/UNKNOWN while preserving the submission ledger.

## Exact remaining implementation gates

| Gap | Missing evidence | Current safe behaviour / next implementation |
|---|---|---|
| Dropzone + Stow empty container | Native container location/hierarchy response for a genuinely empty exact container; positive before/after requested destination proof, correlation and authoritative schema. October 6 SKU capture has no hierarchy cards/table/up result. | Block before mutation when nonempty inventory cannot prove location. Capture/validate native schema, implement one canonical exact location reader, then add empty/contradiction/stale/auth/reload fixtures and both installers. |
| AFT + ISS extra Confirm stages | Native deployed instruction/status/result semantics distinguishing an additional legitimate stage from uncertain execution of the preceding Confirm, with correlated workflow identity and positive operation outcome. | Send one pending inventory Confirm. If native still requests Confirm, retain UNKNOWN and stop; no repeated Confirm/end/replay. Implement further stages only when their own request/outcome contract is proven. |
| Native worker/auth/runtime acceptance | Real Tampermonkey worlds, authenticated native origins, CSP/framing, current native markup/identity, Web Locks and approved live result evidence. | Missing readiness fails before handoff; lost post-handoff response retains UNKNOWN in parent/native ledgers. Continue independent fixes when a concrete defect is reproduced. |

The existing **V4 FCR Native Capture 0.1.2** installer now also matches native AFT Edit/Move/Flip and MoveContainer. Its Tampermonkey menu is **Capture native contract (read-only) 0.1.2**. Invoke it manually on an already open supported page to capture markup and inline/linked source. On FCR, use a deliberate native Container Hierarchy read for an empty container if available. It does not click Confirm, Move, Complete, print or submit, does not collect cookies/storage/headers, and GETs only linked script assets. Containers are consistently pseudonymized within each file; aliases across separate exports are not guaranteed to identify the same container. Review remaining text before sharing. A snapshot is not outcome or authentication proof, and the tool cannot itself recover an absent API response.

## Material V2 differences and verified improvements

Familiar native locations, three ISS areas, scanner control scans, Lazy defaults, date/quantity/Stop controls and toolbar/preset workflows are retained by contract and offline tests; deployed visual and full behavioural parity still need acceptance.

Explicit safety differences: empty-container movement is withheld pending real location proof; AFT does not repeat unknown confirmations (V2 repeated up to ten); known ERRORED AFT recovery is bounded to three fresh workflow attempts; submitted uncertainty is retained rather than silently erased; printer/Carton/Calm handoff is not claimed to prove physical/backend success. Internal FCR read/auth/enrichment capabilities are bundled rather than separately installed old cores. No working interfaces were relocated.

Meaningful verified improvements: zero runtime @require dependencies in all 19 installers; canonical shared hierarchy/move/operation-journal responsibilities bundled independently; durable SUBMITTED/UNKNOWN state and browser-owned locks; optional sanitized OBS evidence; scoped single-owner component styles and one event-driven footer with no recurring interval. Reproduced Sideline cross-owner Reset/late-lock cancellation and Carton stale readiness races were fixed with failing-before/passing-after fixtures. Build crash/disk-failure fixtures reproduced published-file truncation before the fix; compile/stage-all then same-filesystem rename now preserves all 19 prior candidates during interrupted writes. Atomicity is per installer, not an all-or-nothing suite transaction; a publication interruption can leave complete old/new installers, and deterministic --check detects drift. Ordinary failure removes its own staging; hard-kill orphan staging is ignored and never used for installation. ISS immediate recovery feedback and native diagnostic cancellation/redaction are covered by actual source/generated bundle tests. No overall speed, production CPU reduction or full visual/live superiority has been measured.

Recovery saves use actual Sydney system time, creation and verified push times separately, expected-parent non-force GitHub updates and remote readback. The latest checkpoint's NEXT is authoritative; the original baseline OBS-first instruction is historical.

## Recovering the remaining native contracts

Use Native contract capture 0.1.3 on the native FCR/AFT/MoveContainer page. The existing **Capture native contract (read-only)** menu downloads markup/source. **Start passive native response trace** observes only future allowlisted same-origin requests already made by that native page; it sends no request and does not press a control. Use **Stop and export native response trace** before navigating/reloading. Installation and BFCache restoration are inert. Trace stops automatically after 3 minutes or 100 records; bodies are bounded at 250 KB each / 4 MB total. Pending, failed, oversized, binary and unavailable bodies remain explicit. Native fetch Promise/Request identity, XHR events/returns and original responses are preserved in offline fixtures.

FCR captures native hierarchy/up-hierarchy and inventory responses. AFT captures instruction/status/action/end and native page reads. MoveContainer captures its native API response. The diagnostic never decides success or retries an operation. Native Tampermonkey page-world transport interception is an acceptance gate; a zero-record trace must not be interpreted as an empty result. Request-object bodies not supplied synchronously are explicitly unavailable; headers/cookies/storage are excluded. Native container/workflow/request IDs are aliased consistently within one exported file. Review remaining text privately before sharing; do not commit raw exports.

For the empty-container gate, use a read-only native FCR query of one truly empty container and capture its loaded hierarchy/location response plus page/source snapshot. For additional AFT Confirm stages, an explicit approved operational case is required before native actions; capture the correlated instruction/status/action and positive native result semantics. Tracing supplies evidence, not approval or live verification. Drop/Stow/AFT/ISS remain PARTIAL until those contracts can be safely implemented.

Dropzone 0.1.3 fixes two reproduced draft regressions: CLEAR ALL no longer restores erased unsent scans after reload, and a scan received during Run's owner acquisition survives for the next batch/reload. CLEAR DONE preserves the draft; unresolved submissions remain quarantined. This restores scanner/recovery behaviour without changing native locations, UI/styles or movement proof requirements.

Run startup is now tracked by the Dropzone owner: Pause/Clear during delayed browser ownership acquisition cannot resume into movement. Clear waits for startup before erasing only safe rows; submitted results still settle. Generated scanner `123START`/Pause/Clear cases verify that no GM/native mutation is sent in the cancelled startup case.

Bind/Unbind 0.1.2 fixes reproduced scanner loss, mutation after an early Pause and ledger writes after disposal during Start ownership acquisition. Start is tracked immediately, Clear waits for startup, new scanner drafts survive and disposed work cannot erase them. Native payloads, interfaces and positive acknowledgement rules are unchanged; generated independent installers verify `123START`/Pause/Clear startup cancellation with zero native sends. These are offline recovery improvements; native operational/visual/scanner acceptance remains pending.

AFT/ISS 0.1.4 correct mode-selection recovery: explicit mode selection after Stop/Clear gets a fresh execution flag; Clear tracks/awaits its actual owner, preflight reads receive cancellation, and Stop/disposal before lock acquisition performs no reads or ledger writes. Prepared/lost mode actions remain UNKNOWN and block another mode action. Generated native AFT/ISS worker cancellation fixtures verify no subsequent mode/item requests; ISS can report a known unsent preflight rejection. Native opaque IDs/actions and the additional-Confirm safety barrier are unchanged. Both remain PARTIAL until legitimate extra confirmation semantics are captured.
