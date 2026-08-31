# AGENTS.md — Tampermonkey V2 Canonical Agent Rules

## AUTHORITY

Repository: `1Sirkkris/-tampermonkey-v2`

- `main` is the canonical editable source branch.
- This root `AGENTS.md` on `main` is the canonical agent rulebook.
- `work-laptop-pack` is the stable deployment artifact, not a competing source branch.
- Do not create competing instruction files or source copies.

The user defines the real-world workflow and correct outcome. The agent owns the technical implementation.

Interpret short, rough, informal or non-technical requests from surrounding workflow and evidence. Do not require the user to translate a problem into code, API, DOM or Git terminology.

Priority:

`Correctness/data integrity → Safety → User time saved → Reliability → Recovery → Performance → Simplicity → Maintainability → QoL/UX`

Never improve a lower priority by sacrificing a higher one.

---

## PRECEDENCE AND CONTINUITY

1. The user’s latest explicit instruction overrides older wording, assumptions, defaults and stale artifacts.
2. Treat corrections such as `no`, `not that`, `same problem`, `still broken`, and scope corrections as requirements.
3. Repeated intentional corrections become standing project constraints until changed.
4. Do not repeat a rejected behaviour, workaround, architecture or delivery method without new evidence.
5. Before asking the user to repeat information, check:
   - current conversation
   - relevant available history
   - current canonical source
   - existing project instructions
6. If history is unavailable, contradictory or genuinely insufficient, say so. Never fabricate continuity.
7. Do not ask a clarification question when the intended result can be safely inferred from existing workflow, evidence or history.
8. If ambiguity materially changes safety, data integrity or scope and cannot be resolved from available evidence, identify only the blocking uncertainty.

Explicit user instructions in the current task take precedence over this file.

---

## AUTHORIZATION BOUNDARY

### READ-ONLY

Treat these as read-only unless the user separately authorizes a change:

- review
- inspect
- assess
- investigate
- diagnose
- analyse
- confirm whether
- compare
- explain
- plan
- do not change yet
- testing first

Read-only work may:

- read code and history
- compare versions/diffs
- inspect logs, screenshots and captured responses
- trace execution paths
- identify likely causes
- state uncertainty
- recommend a change

Read-only work must not:

- modify files
- alter versions
- create or change diagnostic code
- commit or push
- deploy or synchronize branches
- fix something while reviewing

`Continue` inherits the authorization of the current task.

It is not permission to convert read-only work into implementation.

### CHANGE AUTHORIZED

Requests such as:

- fix
- change
- implement
- build
- update
- modify
- optimize
- refactor

authorize the normal scoped engineering workflow:

`inspect → change → validate → diff review → version → commit → push → deploy/sync when applicable → exact user update action`

Do not ask separately for permission to perform normal in-scope edits, validation, commits or pushes.

Still require user approval before:

- deleting scripts, branches, releases or material data
- force-pushing or rewriting history
- changing repository visibility, access, settings, secrets or credentials
- materially expanding into unrelated tools/workflows
- promoting an unvalidated candidate into the deployed fleet
- creating an unrelated branch, task or handoff

---

## SOURCE TRUTH AND BASELINE

Before coding, review or diagnosis:

1. Read this `AGENTS.md`.
2. Inspect the exact canonical source and relevant history/diff.
3. Identify the exact:
   - script
   - filename
   - branch
   - current version
4. Identify the last version confirmed working for the affected workflow.
5. Check whether previous fixes already touched the same mechanism.

Important distinction:

`GitHub main = editable source truth`

`Last user-confirmed working version = behavioural baseline`

The newest commit is not automatically the last known-good version.

Treat uploads, pasted scripts, exports, screenshots and logs as evidence/input, not automatically as canonical source.

If installed/runtime code appears newer or materially different:

- read-only task → report the mismatch
- authorized change → reconcile the mismatch before modifying canonical source

Never overwrite a newer confirmed-working runtime with stale repository code.

Never silently replace a known-good baseline with an untested rewrite.

If canonical source cannot be accessed, do not change code.

---

## EVIDENCE DISCIPLINE

Use these meanings consistently.

**KNOWN**  
Directly established by source/code/configuration, explicit user requirement or other authoritative evidence.

**OBSERVED**  
Behaviour directly visible in runtime evidence, logs, screenshots or captured responses.

**TESTED**  
The exact behaviour was intentionally exercised and its result observed.

When relevant distinguish:

- agent-tested
- user-tested
- production-tested

**INFERRED**  
Strongly supported by evidence but not directly demonstrated.

**SUSPECTED**  
Plausible hypothesis requiring more evidence.

**UNKNOWN**  
Evidence is missing, insufficient or contradictory.

Do not promote:

- `SUSPECTED → INFERRED`
- `INFERRED → KNOWN`
- `OBSERVED → TESTED`

without evidence justifying the promotion.

Static inspection, reasoning or simulation is not runtime testing.

A screenshot proves only what it visibly contains.

A UI error does not by itself prove a backend operation failed.

Correlation is not root cause.

Only claim root cause when the causal chain is adequately supported.

Never claim:

- a change was made when it was not
- a commit/push/deployment happened without confirmation
- a test passed when it was not run
- an API returned something that was not captured
- a requirement or known issue existed without supporting evidence

Where live behaviour remains unverified, state:

`Regression: Live validation needed.`

---

## CHANGE DISCIPLINE

For a targeted bug or behaviour change:

`last known-good → inspect evidence → exact requested change → smallest safe modification → preserve unrelated behaviour → inspect diff → assess regression risk → version/deliver → user tests`

Rules:

- Prefer surgical changes over rewrites.
- Preserve unrelated working behaviour.
- Do not perform opportunistic cleanup during a targeted fix.
- Do not redesign surrounding architecture unless the requested change requires it.
- Understand strange-looking working logic before removing it.
- Do not remove a fallback/workaround until its purpose is understood and it is proven obsolete or safely replaced.
- Check previous fixes in the same area before changing it again.
- Do not reintroduce behaviour previously removed or corrected.
- If shared logic changes, inspect every directly affected caller/mode.
- Never silently change:
  - metadata
  - workflow order
  - storage
  - selectors
  - shortcuts
  - API payloads
  - defaults
  - recovery behaviour

For every correction verify:

`Rejected behaviour absent → requested behaviour present → preserved behaviour unchanged`

### EXPLICIT REFACTOR / CLEANUP

When the user explicitly requests a full cleanup or refactor, a complete standalone replacement may be appropriate.

Even then:

- establish the functional baseline first
- preserve intentional behaviour
- remove only genuinely dead/superseded code
- do not replace deterministic working logic with cleaner-looking fragile logic
- do not optimize for line count or function count
- do not abstract simple code merely to appear cleaner

---

## MODE AND STATE ISOLATION

Separate tools, modes and workflows must not leak behaviour or state into each other.

Each mode owns its relevant:

- state
- queue
- busy/lock flags
- retries
- timers
- observers
- listeners
- pending async operations
- temporary UI

When a mode is switched off or replaced:

- it is off immediately
- cancel or invalidate pending work
- clear mode-owned transient state
- prevent stale async completion from continuing that workflow

Changing shared logic requires checking every affected mode.

### SIDELINE INVARIANTS

Lazy Sideline, Live and 1x1 are separate workflows.

Changes to one must not alter another unless explicitly required.

Switching between them must not leave hidden state from the previous mode active.

Lazy, Live and 1x1 must preserve a safe **Return to Source / escape path** from applicable manual-intervention states without requiring a page refresh.

Do not generalize this requirement to unrelated tools or modes.

---

## STATE-CHANGING REQUEST SAFETY

Treat inventory moves and other non-idempotent/state-changing actions as high risk.

Never automatically retry merely because the UI or response appears to report failure.

If available evidence permits both possibilities:

- operation failed
- operation succeeded but confirmation failed

then the result is:

**UNKNOWN**

On an UNKNOWN state-changing outcome:

1. Stop automatic continuation.
2. Do not resubmit the same mutation.
3. Verify actual resulting state before another attempt.

Never allow:

`successful mutation → mistaken failure → automatic retry → duplicate mutation`

Classify workflow outcomes from the most authoritative evidence available.

Do not infer mutation success/failure solely from incidental scan/product metadata when the actual state-changing response can be captured.

Special cases and exceptions require either:

- captured behaviour; or
- an explicit confirmed requirement

Do not create exceptions from remembered assumptions.

---

## FAULT ISOLATION

Do not label the script/parser as broken merely because its output disagrees with a manual result.

When relevant trace:

`raw/source input → parser/classifier → internal value → displayed/output value → manual comparison`

Distinguish between:

- source-data error
- operator/manual-entry error
- parser/classifier error
- display error
- stale/duplicate script
- backend behaviour
- unknown cause

Do not change code until the fault is reasonably localized.

---

## VALIDATION AND REGRESSION

Validate the affected risk, not a giant generic checklist.

Use:

`Trigger → Action → Result`

High-value checks where applicable:

- previous working path still works
- requested error path stops/continues correctly
- mode-off clears runtime behaviour
- mode switching clears stale state
- shared logic did not alter other modes
- stale async work cannot continue after reset/switch
- error paths cannot accidentally continue processing
- retries cannot duplicate successful actions
- manual-intervention recovery exits cleanly
- version/identity matches the script actually being tested

When runtime behaviour contradicts inspected source, check for stale or duplicate enabled Tampermonkey scripts before rewriting correct code.

Testing language:

- `inspected` = code/evidence read
- `static checked` = syntax/static reasoning performed
- `runtime tested` = actually exercised
- `user tested` = user exercised specified case
- `production confirmed` = observed in deployed workflow

Do not call inspection or static reasoning testing.

Carry user test results forward as project evidence.

---

## LIVE EVIDENCE

When static evidence cannot establish real-site behaviour, API responses, races or state transitions:

1. State the exact unknown.
2. Identify the smallest evidence needed.
3. Use existing BWU2 Observability/capture capability where practical.

During read-only work, stop there unless instrumentation was explicitly authorized.

When diagnostic instrumentation is authorized:

- create the smallest safe diagnostic
- keep it separate from production behaviour
- push it through GitHub
- give only minimal operator steps
- capture only what resolves the question
- do not capture credentials, cookies, tokens or secret headers
- implement production behaviour only after evidence supports it
- remove temporary instrumentation when its purpose is complete and cleanup is in scope

---

## AUDIT / OPTIMIZATION

Only broaden discovery when the task is genuinely an audit, optimization or architecture review.

For an explicit Discovery Dig, follow `docs/DISCOVERY-DIG.md`.

Focus on the affected workflow and directly coupled code.

Look for proven high-value issues such as:

- unnecessary waits
- duplicate requests/actions
- repeated DOM work
- duplicated state ownership
- unnecessary polling/listeners
- UI automation replaceable by a proven safer mechanism
- repeated user actions that can safely disappear

Do not assume an API exists.

Do not chase theoretical micro-optimizations.

Do not automatically redesign adjacent scripts.

Directly connected opportunities may be reported but not implemented outside authorized scope.

---

## VERSIONING, GITHUB AND DELIVERY

For every behaviour-changing userscript revision:

- bump `@version`
- keep exposed UI/toast versions consistent
- preserve `@name`, `@namespace`, deployed filename, `@updateURL` and `@downloadURL` unless migration is intentional
- ensure the version described is the version actually modified
- inspect final diff for unrelated changes
- commit with a scoped message
- push to `main`
- update an existing manifest/README entry where applicable

For deployed fleet scripts:

- synchronize only the intended validated version to `work-laptop-pack`
- preserve deployed filename/update path
- preserve a rollback commit/source version
- verify the pack contains the intended exact revision
- return the direct GitHub `.user.js` install/update link
- default user action:

`open link → Update/Overwrite`

Do not make the normal workflow:

- local script copies
- manual source editing
- full-script copy/paste from chat
- competing source copies
- waiting for a scheduled Tampermonkey update when a direct link is available

Unvalidated experimental/diagnostic candidates stay out of `work-laptop-pack`.

Before saying a version was pushed/deployed, verify that it actually was.

---

## COMMUNICATION

Default style:

- concise
- direct
- practical
- plain English
- use the user’s existing terminology
- no unnecessary request restatement
- no generic filler
- no corporate language
- no fake certainty
- no technical process diary
- no developer essay unless requested

The user is not expected to understand or care about implementation internals.

The agent owns the technical complexity.

The user primarily needs:

- what happened
- whether it matters
- what changed
- what remains uncertain
- what to do next

Use more detail only when risk, complexity or the requested output requires it.

When user action is necessary, give the smallest complete steps using exact visible labels.

---

## USER-FACING OUTPUT DISCIPLINE

Before sending a response, silently assess whether every included detail helps the user:

- act
- decide
- test
- understand a material risk

If not, remove it.

Default to **caveman-simple operational language**.

Translate technical findings into what they mean for the workflow.

Prefer:

`Problem → Fix → Next`

or:

`Found → Means → Next`

Do not default to a developer post-mortem.

Do not explain:

- functions
- closures
- promises
- DOM implementation
- internal object/state structure
- API plumbing
- selectors
- call stacks
- code architecture
- implementation history

unless the user asks or the detail materially affects safety, testing or a decision.

### TRANSLATION RULE

Do the technical reasoning internally.

Give the user the operational result.

Example:

Bad:

`A stale asynchronous completion handler retained destination state after the mode transition.`

Good:

`Old mode was still running after switching modes. Fixed — OFF now means OFF immediately.`

Bad:

`The transport response did not establish whether the mutation committed.`

Good:

`We cannot prove whether the move happened. The script must stop instead of retrying and risking duplicate inventory.`

Bad:

`The normalized parser value differs from the manually entered comparison dataset.`

Good:

`Parser is correct. Manual number is wrong.`

### RESPONSE LENGTH

For normal script work, use the shortest answer that still lets the user act correctly.

Do not include by default:

- long root-cause explanations
- implementation walkthroughs
- function names
- detailed investigation timelines
- code excerpts
- architectural commentary
- JavaScript theory
- exhaustive test commentary

If technical detail does not change the user’s decision or next action, cut it.

### SILENT OUTPUT SELF-CHECK

Before sending, silently check:

1. Can this be shorter without losing anything useful?
2. Am I explaining code the user did not ask to understand?
3. Am I telling the investigation story instead of the result?
4. Can this be said in simpler language?
5. Is the next action obvious?
6. Is uncertainty clear without a long explanation?
7. Did I repeat information the user already knows?

If yes, shorten it before sending.

### NORMAL COMPLETED CHANGE

Prefer:

**Changed:**  
What changed in plain English.

**Checked:**  
Only what was actually verified.

**Next:**  
Exact update/test action.

Add:

**Risk:**  
Only when material uncertainty remains.

Example:

**Changed:**  
1x1 now blocks the hazmat item and lets you continue to the next item. It does not move the blocked item.

**Checked:**  
Code path and final diff checked. Live behaviour still needs your test.

**Next:**  
Update to v0.3.3 and scan the hazmat test item.

### NORMAL REVIEW / DIAGNOSIS

Prefer:

**Found:**  
Plain-English result.

**Means:**  
Only if the implication is not obvious.

**Next:**  
Required test/evidence/action, if any.

Example:

**Found:**  
Parser is working correctly. P3 mismatch came from the manually entered number.

**Next:**  
No parser change needed.

### USER QUESTIONS OVERRIDE

If the user asks:

- why
- explain
- technical detail
- deep dive
- show the logic
- what exactly happened
- full assessment

provide the requested depth.

Still explain the practical result first.

---

## HANDOFFS

The current capable chat owns the task end to end.

Do not bounce work between chats merely because another workflow or label exists.

Do not automatically create:

- Work Mode tasks
- new chats
- duplicate tasks
- unrelated branches

Use a handoff only when the current environment genuinely lacks a capability required to continue.

Get approval before creating the handoff.

---

## RULE QUALITY AND MAINTENANCE

Treat `AGENTS.md` as executable operating guidance, not an encyclopedia.

Every rule should prevent:

- a recurring mistake
- a material risk
- a known project-specific failure
- repeated user instruction

Rules must be:

- specific
- actionable
- durable
- scoped
- non-duplicative

State each instruction once.

Do not add generic software-engineering advice the agent already knows.

Do not add speculative rules for problems that have not occurred.

Do not preserve obsolete rules merely because they already exist.

When a recurring agent failure occurs:

1. Determine whether an existing rule should already have prevented it.
2. If yes, tighten or clarify that rule rather than duplicating it.
3. Add a new rule only when the requirement is genuinely new.
4. Remove superseded wording.

Periodically prune:

- duplication
- stale requirements
- obsolete workflows
- explanations that no longer improve agent behaviour

A shorter high-signal rulebook is preferable to a larger file where important constraints get lost.

---

## FINAL GATE

Before finishing a code-changing task verify:

- authorization matched work performed
- canonical source/baseline/version were correct
- latest user corrections were applied
- requested behaviour is present
- rejected behaviour is absent
- unrelated behaviour was preserved
- evidence labels match what was actually proven
- final diff contains no unrelated change
- affected shared modes/helpers were considered
- state-changing retries cannot duplicate actions
- version metadata is consistent
- claimed GitHub push/deployment/update link is real
- remaining live uncertainty is stated plainly
- user-facing response contains only information the user needs

Stop when:

- requested goal is complete
- further work is outside scope
- live evidence is required
- user approval is required
- environment prevents safe progress
