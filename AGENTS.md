# AGENTS.md — Tampermonkey V2 Canonical Agent Rules

## AUTHORITY

Repository: `1Sirkkris/-tampermonkey-v2`

- `main` is the canonical source branch.
- This root `AGENTS.md` on `main` is the single canonical coding rulebook.
- `work-laptop-pack` is a deployment artifact, not a competing source or instruction branch.
- Do not create or maintain branch-specific instruction variants.

The user defines the real-world outcome. The agent owns the technical implementation.

The user is the Amazon FC workflow/domain expert and is not expected to speak in coder language. Interpret short, rough, misspelled, or informal requests using the surrounding workflow and evidence. Do not nitpick terminology when the intended outcome is clear.

Do not require the user to understand code, APIs, DOM internals, request payloads, browser architecture, concurrency, frameworks, Git, or debugging tools.

Optimize in this strict order:

**Correctness/data integrity → Safety → User time saved → Reliability → Recovery → Performance → Simplicity → Maintainability → QoL/UX**

Never sacrifice an earlier priority merely to improve a later one.

## USER / AGENT CONTRACT

Ask the user only for information they can reasonably provide:

- what they normally do
- what they want to happen
- what visibly happened
- what result is correct
- a business/workflow constraint that cannot be inferred

Do not ask the user to:

- choose technical architecture
- inspect or patch code
- use DevTools manually
- find endpoints or payloads
- select concurrency limits
- interpret raw technical errors
- carry code or prompts between chats when tools can do it

Make technical decisions yourself. Ask one short question only when the answer materially changes correctness, safety, destructive scope, or intended behaviour.

When user action is unavoidable, provide the smallest complete numbered steps using exact visible labels.

## INTENT ROUTER

Interpret the user's verb as authorization scope.

### Review / explain / plan / assess

- Inspect and report only.
- Read-only GitHub and diagnostic checks are allowed.
- Do not edit, commit, push, deploy, or start a new task unless asked.

### Diagnose / investigate

- Inspect and establish the cause.
- If static evidence is insufficient, create and push the smallest non-production diagnostic needed to finish the diagnosis.
- Do not change or promote production behaviour unless the user also asked to fix/change it.

### Fix / change / build / improve / optimize / update / continue

- Complete the in-scope engineering end to end.
- Inspect the canonical repo and applicable rules.
- Edit the real source, version it, validate it, inspect the diff, commit it, push it, and deliver through GitHub.
- A code-change request is standing authorization for the normal scoped commit and push. Do not ask separately whether to commit or push.
- Do not stop at a local file or paste a replacement script into chat as the normal delivery.

### Approval still required

Ask before:

- deleting scripts, branches, releases, or material data
- force-pushing or rewriting history
- changing repository visibility, settings, access, or secrets
- adding production dependencies or credentials
- modifying unrelated tools or expanding scope materially
- promoting an unvalidated experimental/diagnostic candidate into the deployed fleet
- creating a new branch outside the existing source/deployment workflow
- creating a new Work Mode task/chat

## STARTUP / SOURCE TRUTH

Before any Tampermonkey coding, review, diagnosis, or architecture work:

1. Fetch and follow this `AGENTS.md` from `main`.
2. Inspect the current canonical repository source and relevant history/diff.
3. Treat Project uploads, pasted scripts, exports, logs, and screenshots as evidence/input, not automatically as the source of truth.
4. If the installed/runtime script appears newer or materially different, reconcile it into the repository before changing it. Never overwrite a newer working runtime with stale GitHub code.
5. If the canonical repo or this rulebook cannot be accessed, stop before changing code and report `ENVIRONMENT BLOCKED`.

Never wait for the user to say "use agent prompt."

## TASK MODES

### PATCH

Something broke. Reproduce or establish the failure, then use the smallest reliable root-cause fix. Preserve all unrelated behaviour.

### IMPROVE

Existing behaviour works but can be faster, safer, simpler, more reliable, or easier. Prove the main waste before changing architecture.

### BUILD

Add a new capability using the smallest mechanism that satisfies the real workflow.

### AUDIT / ARCHITECTURE

Map the relevant ecosystem first. Rank opportunities by impact, evidence, effort, and regression risk. Do not tunnel-vision on the first API or rewrite the fleet without proof.

Core loop:

**Find → Understand → Measure → Decide → Build → Validate → Clean up → Deliver**

## BOUNDED DISCOVERY

For IMPROVE, BUILD, and AUDIT work, inspect the relevant scripts/pages/services for:

- UI automation replaceable by an authorized direct request
- duplicate/in-flight-equivalent requests
- data already present in HTML, application state, storage, sibling responses, or shared cores
- serial work that can safely use bounded concurrency or batching
- repeated navigation/page loads
- DOM scraping/rendering that can disappear
- always-on polling, observers, timers, or listeners that can become lazy/event-driven
- duplicated clients, caches, parsers, routing, normalization, or state ownership
- opportunities to remove user actions or whole obsolete subsystems

After the first sweep:

1. identify the top three practical opportunities
2. select the highest-value sufficiently proven option
3. implement and validate it

Resume discovery only when new evidence changes the ranking. Broad does not mean infinite.

Prefer one authoritative owner per shared responsibility where it removes real duplication. Merge scripts only for measured value, not file count or architectural neatness.

## ENGINEERING CONTRACT

Protect external and workflow contracts unless change is required and justified:

- userscript name, filename, version, `@match`/`@include`, `@updateURL`, and `@downloadURL`
- endpoints, methods, payloads, quantities, and ordering
- storage/cache keys and persisted preferences
- selectors, labels, IDs/classes, shortcuts, and focus behaviour
- source/destination/item separation
- expiry/date semantics
- cancellation, recovery, and partial-completion behaviour

For affected code, check:

- duplicate initialization
- SPA/page/route changes
- missing or replaced DOM
- stale asynchronous completion
- repeated actions and races
- malformed/changed responses
- timeouts, retries, cancellation, and partial failure
- invalid/expired storage and caches
- Firefox, Chrome, Tampermonkey, userscript/page world, CSP, iframes, and `GM_*` behaviour where relevant

Runtime rules:

- Use initialization guards.
- Give observers, timers, listeners, and patches a clear owner, narrow scope, duplicate protection, and cleanup.
- When inactive, prefer zero requests, zero polling, and zero repeated full-page scans where practical.
- Deduplicate identical in-flight reads and share results.
- Validate required response fields before consuming them.
- Use bounded concurrency and abortable long/multi-request runs.
- Never blindly retry state-changing requests.
- Treat external strings as hostile; prefer safe text rendering and avoid unsafe evaluation.
- Remove superseded UI automation, waits, observers, selectors, fallbacks, diagnostics, and debug output after the replacement is proven.

For every affected workflow, verify:

**Trigger → Action → Result**

## PERFORMANCE CONTRACT

Performance means the complete real workflow finishes sooner without increasing mistakes, backend risk, page freezing, or recovery cost.

Profile or prove the main bottleneck first. Do not micro-optimize cold code.

Where measurable, compare the same workflow before and after using:

- total workflow time
- requests and retries
- user clicks/scans/copy-pastes/page changes
- repeated DOM scans and rendered work
- observer/timer activity
- browser long tasks
- failures and recovery behaviour

Use repeated runs and a median when practical. Never invent numbers or claim speed from code appearance alone.

If improvement is real but cannot be safely measured, say so plainly.

## LIVE EVIDENCE

Use live evidence when static review cannot prove real-site behaviour, private API contracts, session behaviour, dynamic DOM, races, response shapes, or performance.

1. State the exact claim or unknown.
2. Create the smallest safe diagnostic using existing BWU2 Observability tooling where practical.
3. Commit/push the diagnostic through GitHub; do not make the user manually patch code.
4. Give exact minimal operator steps.
5. Capture only what resolves the question.
6. Separate confirmed, inferred, and unknown.
7. Implement only what evidence supports.
8. Retest and remove temporary instrumentation.

Never capture or commit credentials, cookies, tokens, secret headers, or unnecessary identifiers/payloads.

If live validation is still required, report exactly: `Regression: Live validation needed.`

## VERSIONING, GITHUB, AND DELIVERY

For every behaviour-changing userscript revision:

- bump `@version`
- keep exposed UI/toast version labels consistent
- preserve deployed filenames and update URLs unless an intentional migration is required
- validate the affected workflow as far as the environment allows
- inspect the final diff for unrelated changes and secrets
- commit with a scoped message and push to `main`
- update any existing version manifest/README entry affected by the change

Stable fleet delivery:

- Synchronize the exact validated version to `work-laptop-pack` when that script is part of the deployed work-laptop fleet.
- Preserve the pack filename and Tampermonkey update path.
- Record the source commit/version so rollback remains possible.
- After pushing, tell the user only the exact Tampermonkey action required, normally `Tampermonkey → Utilities → Check for userscript updates`.

Experimental/diagnostic delivery:

- Keep genuinely unvalidated candidates out of deployed update paths and out of `work-laptop-pack`.
- Store them in the repository using the existing test/diagnostic convention so GitHub remains the source of truth.
- Provide a GitHub install/update path and the exact live-validation steps.
- Promote only after evidence supports it.
- A long-lived script containing `TEST` in its name is not automatically experimental; deployment intent and current fleet status control.

Never make the normal user workflow:

- manually edit code
- copy/paste a full replacement script from chat
- choose between competing source copies
- remember to ask for GitHub synchronization

If GitHub write/sync is blocked, do not silently leave a local-only revision. Report `ENVIRONMENT BLOCKED` and state the single missing capability.

## WORK-LAPTOP PACK

`work-laptop-pack` is the stable deployment branch.

- No speculative changes.
- Only synchronize deliberately selected, validated fleet versions.
- Keep exact deployed filenames/update paths and a rollback commit.
- Confirm the pack points to the intended source revision.
- Do not use the branch as an independent coding source or keep a competing `AGENTS.md` there.

## HANDOFFS

The current capable chat owns the task end to end. Do not bounce work between Overseer, Research, Live Evidence, and repo coding merely because those labels exist.

Use another chat only when its environment provides evidence or repository access the current chat genuinely lacks.

Never create or send to Work Mode automatically. Before any handoff say exactly:

`REQUESTING TO SEND TO WORK MODE - WILL CREATE NEW CHAT`

Then wait for approval. Do not create duplicate tasks. Give one complete copy-paste handoff only when a handoff is unavoidable.

## FINAL PASS / DONE

Before completion:

- review changed and directly affected areas
- run relevant syntax/tests/checks
- inspect the final diff
- remove newly obsolete code and diagnostics
- confirm version metadata and deployment paths
- verify the GitHub commit/push and pack sync when applicable
- preserve rollback

Stop when the goal is complete, remaining work is low-value/out of scope, live evidence is required, approval is required, or the environment blocks progress.

Keep the user-facing completion brutally short and in plain language:

- `Changed:` what is different
- `Proof:` what was checked
- `Risk:` only material remaining risk
- `Next:` one exact user action, or `None`

For an end-of-day report when requested, use only:

`Script | Start version | End-of-day version | Revisions today`

Include touched scripts only unless the user asks for the full fleet.

Finish with exactly one:

- `OFFLINE WORK COMPLETE`
- `LIVE EVIDENCE REQUIRED`
- `USER DECISION REQUIRED`
- `ENVIRONMENT BLOCKED`
