# DISCOVERY-DIG.md — Tampermonkey V2 Improvement Discovery

## PURPOSE

This is a specialist read-only discovery playbook, not a competing agent rulebook.

`AGENTS.md` remains authoritative.

Use this file only when the user explicitly requests a Discovery Dig or the scheduled Discovery Dig runs.

The goal is to find safe, evidence-backed ways to make the user's real workflows faster, easier, more reliable and less dependent on fragile browser/UI automation.

Do not implement production changes during a Discovery Dig unless the user separately authorizes them.

## OBJECTIVE

Find the best practical opportunities to reduce:

- user actions
- waiting
- page loads/reloads
- repeated scans/clicks/copy-paste
- fixed sleeps and DOM waits
- fragile selectors and UI sequencing
- unnecessary rendering
- unnecessary or duplicate requests
- large/repeated data pulls
- polling/listener overhead
- manual recovery work
- repeated navigation between tools

Do not assume the current implementation is best merely because it works.

Do not assume an API, endpoint or direct mechanism exists. Discover it from evidence.

## DISCOVERY TARGETS

Inspect recent work, active scripts and directly relevant application behaviour for opportunities such as:

- DOM/UI automation replaceable by a proven existing XHR/fetch/API request
- data already available in application state, HTML, storage or an earlier response
- requests that can be safely suppressed, reduced, cached or deduplicated
- repeated full-page/product/inventory pulls that are not needed for the actual workflow
- fixed waits replaceable by deterministic events or state
- polling replaceable by event-driven behaviour
- several UI actions replaceable by one deterministic operation
- unnecessary page navigation or refreshes
- repeated manual copy/paste or classification
- old implementations retained only because a better mechanism was not previously known
- new evidence from the last two weeks that changes what is technically possible

Always ask:

**Is there a more direct, safer or faster way to achieve the same real-world result?**

## FORENSIC WINDOW

For a scheduled dig, review the most relevant evidence from approximately the previous two weeks, including where accessible:

- recent commits/diffs
- scripts changed or repeatedly discussed
- user-reported friction
- testing outcomes
- recurring failures/recovery steps
- newly captured XHR/fetch/API behaviour
- performance complaints or waits
- repeated manual user actions
- known next-enhancement candidates

Do not manufacture opportunities from unrelated code merely to fill the report.

## METHOD

1. Map the current workflow in plain operational terms.
2. Identify the biggest real user-time, reliability or performance waste.
3. Inspect what the page/application is actually doing underneath that step.
4. Look for a more direct mechanism.
5. Gather enough evidence to establish that the mechanism genuinely exists.
6. Estimate the likely user benefit.
7. Identify material correctness/data-integrity/regression risk.
8. Define the smallest safe experiment needed to prove or reject it.
9. Keep unproven experiments separate from stable deployed behaviour.
10. Stop after the strongest opportunities are identified.

## PRIORITY

Rank findings in this order:

`User time saved → Reliability gain → Performance gain → Recovery gain → Implementation risk`

Correctness and data integrity remain mandatory and override every optimization benefit.

Prefer one high-value proven opportunity over many speculative ideas.

## SAFE EXPERIMENT DESIGN

When an opportunity is promising but not proven, design the dumbest safe test that answers the question.

The user is not expected to understand the technical mechanism.

Explain any required test as:

**What we are testing:** one plain-English sentence.

**Do this:** the smallest numbered operator steps using exact visible labels.

**Good result:** what should visibly happen.

**Bad result:** what means stop.

Do not make the user inspect code, DevTools, payloads or architecture when existing capture/observability tooling can gather the evidence instead.

## SCOPE CONTROL

Discovery is deliberately broader than a normal bug fix, but it is not unlimited.

- Focus on active/recent/high-friction workflows first.
- Do not redesign unrelated scripts.
- Do not chase theoretical micro-optimizations.
- Do not propose cleanup merely because code looks ugly.
- Do not recommend a rewrite without evidence that the current mechanism is materially limiting the workflow.
- Do not implement findings during the dig without separate authorization.
- Maximum three final opportunities.

## OUTPUT

Do not send a technical story.

Return only the top 1–3 evidence-backed opportunities.

For each:

**Current:** what sucks now.

**Possible:** better method in plain English.

**Gain:** why the user should care.

**Evidence:** why this is a real opportunity rather than a guess.

**Proof needed:** smallest safe test/evidence required before implementation.

**Risk:** material risk only; omit if negligible.

Finish with:

**Best pick:** the single opportunity with the strongest benefit-to-risk ratio.

If nothing worthwhile is found, say:

`No worthwhile discovery this cycle.`

Do not invent findings to make the dig look productive.
