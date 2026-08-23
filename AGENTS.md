# AGENTS.md — Tampermonkey V2 Canonical Agent Instructions

## Scope

This file is the canonical operating instruction set for the entire repository.

It applies to all files and directories unless a deeper `AGENTS.md` explicitly overrides a rule for that subtree.

When working in this repository, do not merely tune the visible implementation. Challenge whether the current implementation should exist at all.

Assume older userscripts may have been built by copying what the visible UI does because a better backend architecture was unknown at the time.

The goal is to make the helper materially faster, simpler, safer, and more reliable than the original application/workflow it assists or replaces.

---

# WORKFLOW / BACKEND GOD MODE

## Core loop

**FIND → UNDERSTAND → MEASURE → DECIDE → BUILD → VALIDATE → CLEANUP GOD MODE → REPEAT**

Do not tunnel-vision on the first promising idea.

Run broad discovery first, map the ecosystem, rank opportunities, then attack the highest-value architecture.

---

# GUIDED OPERATOR MODE

The user is not expected to know what technical evidence you need.

Do not wait for the user to invent the correct debugging procedure.

You decide:

- what needs proving
- what evidence is missing
- what diagnostic should capture it
- what exact user action will trigger it
- what result should be returned
- what should happen next

When live evidence is required, make the user's job brain-dead simple.

Good example:

1. Install diagnostic.
2. Open the exact target page.
3. Perform the normal workflow once.
4. Click the supplied Mark/Copy control.
5. Return the captured output.

Do not ask vague questions such as:

> Can you inspect the network calls?

Build or specify the evidence capture yourself.

---

# BROAD DISCOVERY FIRST

Before optimizing one script or endpoint, audit across the entire script fleet and the underlying applications.

Look for architectural wins in the following areas.

## UI automation → backend

Look for:

- clicks that could become direct requests
- forms that submit predictable APIs
- page navigation used only to trigger backend work
- modal workflows that call an API internally
- scanner emulation
- synthetic keyboard events
- hidden iframes
- scraped result pages
- waits for controls that merely represent backend state

Question:

**Can we bypass the UI completely?**

Prefer direct authenticated same-origin backend requests when they are measurably safer and simpler than DOM automation.

---

## Network

Look for:

- duplicate requests
- equivalent endpoints
- APIs already returning data another script separately fetches
- giant application fan-out
- per-row requests
- per-pod requests
- per-item requests
- unnecessary pagination
- hidden totals or metadata in the first response
- endpoints returning more useful structured data than the UI displays
- requests made only because the native UI requires them
- responses never consumed
- repeated session/auth/request bridge implementations
- opportunities for request deduplication

Question:

**Are we asking the backend for the same thing multiple times?**

Prefer one shared request/data core where multiple helpers need the same source data.

---

## Data availability

Look for data that already exists in:

- initial HTML
- bootstrapped JSON
- API responses
- `window` globals
- application state
- React/Vue/other framework state
- storage
- previous workflow responses
- sibling requests
- headers and metadata
- totals embedded in labels
- hidden attributes
- existing cross-script data cores

Question:

**Are we calculating or fetching something the application already knows?**

Do not refetch information already available locally unless freshness or correctness requires it.

---

## Serial → parallel

Find:

- independent requests running serially
- arbitrary delays between independent work
- per-item waits
- per-container waits
- per-row waits

Determine whether safe concurrency or batching is possible.

Do not blindly increase concurrency.

Measure:

- backend latency
- throttling
- burst degradation
- browser impact
- ordering requirements
- error/retry behavior

Use bounded concurrency.

Question:

**What can happen simultaneously without breaking workflow correctness?**

---

## Always-on → lazy

Find:

- expensive startup work
- prefetching that is rarely used
- observers active on irrelevant screens
- polling active while a feature is idle
- data loaded before the user indicates interest
- cross-page helpers running everywhere

Question:

**Can this work happen only when needed?**

Prefer page/feature gating, lazy initialization, and event-driven work over permanent observers or polling.

---

## DOM / rendering

Find:

- thousands of rows rendered only to calculate a number
- HTML attached to the page solely to parse it
- tables repeatedly rebuilt
- entire native application screens loaded to extract one value
- DOM used as a database

Prefer:

**fetch → parse detached/structured response → retain required values → discard unnecessary data → render only useful UI**

Question:

**Can we process the information without making the browser render the original application's garbage?**

---

## Pagination

Investigate:

- totals available before pagination
- record counts
- quantity headers
- continuation metadata
- `hasNext` flags
- hidden server-side aggregates
- alternate endpoints
- page-size controls
- whether pagination is actually required for the desired result

Never assume:

**50 records = 50 units.**

Question:

**Can we stop after page one?**

Only paginate when the desired answer truly requires record-level traversal.

---

## Cross-script duplication

Map:

- identical API clients
- duplicated URL detection
- duplicated product parsing
- duplicated hierarchy lookup
- duplicated bin-size logic
- duplicated caches
- repeated state handling
- repeated panel/dock code
- repeated request cancellation logic
- repeated parsing and normalization helpers

Question:

**What should become a shared core instead of being reimplemented in every userscript?**

Consolidate only when doing so reduces complexity and failure surface. Do not build a giant abstraction layer merely for elegance.

---

# DISCOVERY SWEEP REQUIREMENTS

Before a major rewrite, build a simple architecture map covering:

1. user action
2. native UI path
3. script interception/automation
4. network calls
5. response shape
6. data dependencies
7. current bottlenecks
8. likely backend replacement path
9. proof still required

Rank opportunities by practical value, for example:

- major workflow elimination
- major latency reduction
- reliability improvement
- request reduction
- rendering reduction
- code deletion/simplification
- minor UI polish

Do not spend the mission polishing a low-value path while a high-value architectural bypass remains unexplored.

---

# EVIDENCE BEFORE ASSUMPTION

Treat uncertain application behavior as something to prove.

When evidence is missing:

1. state the exact unknown internally
2. build the smallest useful diagnostic
3. capture only the data required to resolve it
4. keep the user's action simple
5. compare observed behavior against the hypothesis
6. remove temporary instrumentation after the conclusion is proven

Do not permanently ship speculative code when a short live-evidence pass can prove the behavior.

Use existing Live Evidence tooling where practical instead of inventing one-off manual inspection instructions.

---

# MEASURE BEFORE AND AFTER

For performance-sensitive changes, compare the old and new path.

Capture useful measures such as:

- total wall-clock workflow time
- request count
- request latency
- retries/failures
- number of page loads/navigation events
- rendered row count
- observer/polling activity
- manual interactions removed

A change is not automatically an improvement because it uses an API.

Prefer the architecture that is measurably faster, simpler, and at least as reliable.

---

# BUILD RULES

## Preserve workflow correctness

Do not trade correctness for speed.

Maintain:

- cancellation behavior
- clear user-visible error states
- protection against duplicate runs
- input validation
- source/destination/item separation where relevant
- quantity correctness
- expiry correctness
- safe recovery after partial failure

## Prefer deletion over layering

When a backend path replaces UI automation, remove obsolete waits, selectors, keyboard emulation, and observers instead of leaving both architectures entangled indefinitely.

## Smallest reliable mechanism

Prefer the least complicated implementation that fully solves the real workflow.

Do not introduce frameworks, build systems, dependencies, or abstractions unless they materially improve the project.

## Bounded concurrency

Any parallel request system must have an explicit concurrency limit and sensible failure handling.

## Abortable runs

Long or multi-request workflows should support cancellation so stale work cannot continue after the user starts a new run or changes context.

## Idempotence / duplicate protection

Protect against:

- duplicate script injection
- duplicate observers
- duplicate panels
- duplicate submissions
- repeated scanner events
- stale async completion writing into a newer run

---

# VALIDATION

Do not stop at "the code looks right."

Validate the actual workflow.

For each meaningful change, test or reason through:

- happy path
- empty input
- duplicate input
- malformed input
- partial backend failure
- cancellation
- page navigation/context change
- unexpected response shape
- slow response
- repeated run
- stale async work

When live access is necessary, switch back to Guided Operator Mode and request one precise evidence capture.

---

# CLEANUP GOD MODE

After a successful change, perform a cleanup pass.

Remove:

- obsolete selectors
- dead UI automation
- superseded endpoints
- duplicate helpers
- temporary diagnostics
- stale comments
- unused constants
- old version labels
- console spam
- unreachable fallback code
- speculative branches that evidence disproved

Then ask again:

- can another request disappear?
- can another observer disappear?
- can another page load disappear?
- can another copy of the same logic disappear?
- can the whole feature become smaller now that the architecture is understood?

---

# REPOSITORY / DELIVERY RULES

## Canonical instructions

`AGENTS.md` at repository root is the authoritative agent instruction file for this repository.

When future architectural rules are agreed with the user, update this file so the repository remains self-describing.

## Versioning

When modifying a userscript:

- bump the userscript version when behavior changes
- keep version labels consistent between metadata and visible UI/toasts where the script already exposes them
- do not rename deployed artifacts casually when an existing filename/link is part of the rollout mechanism

## Secrets

Never commit:

- auth tokens
- cookies
- session values
- passwords
- private credentials
- captured request headers containing secrets
- sensitive live-evidence payloads that are unnecessary for source control

Sanitize diagnostics before committing them.

## Existing working behavior

Do not rewrite stable working code solely for style.

Prefer the smallest architecture-changing patch that produces a real measurable gain.

If a stable implementation is being replaced, preserve a clear rollback path through git history/commits rather than maintaining dead duplicate code in the active script.

---

# PROJECT OPERATING MODEL

The working architecture is:

## ChatGPT project

- **OVERSEER** — main brain / work-access coordinator
- **LIVE EVIDENCE** — evidence capture and observation
- **research chats** — supporting investigation

## GitHub repository

- **`AGENTS.md`** — canonical persistent copy of these operating rules
- repository source — authoritative versioned code and history

## Codex / local project

- **Audit repository architecture** — actual coding/audit workspace

Use GitHub plus this `AGENTS.md` as the durable handoff between future sessions and agents.

---

# DEFAULT MISSION BEHAVIOR

When asked to improve, audit, optimize, or continue this project:

1. Read this `AGENTS.md` first.
2. Inspect the current repository rather than trusting an old pasted copy.
3. Broadly map the relevant workflow and sibling scripts.
4. Look for backend/data-path replacements before tuning DOM automation.
5. Rank architectural opportunities.
6. Prove uncertain behavior with targeted evidence.
7. Implement the highest-value safe improvement.
8. Validate the real workflow.
9. Perform Cleanup God Mode.
10. Record durable architectural rules back into this file when appropriate.

The target is not "a nicer userscript."

The target is the smallest, fastest, most reliable workflow the available backend and browser environment can support.
