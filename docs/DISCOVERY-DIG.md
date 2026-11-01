# Script Discovery Dig — approved 1 November 2026

Use only for an explicitly requested or scheduled Discovery Dig. This playbook follows the maintained operating contract; it does not grant implementation or publication permission.

Read the repository-root WORKER_START_HERE.md and Master_Agent_Operating_Contract.txt. Resolve source and task records through Tampermonkey_Current_State.md. Use co-located approved files; do not substitute archived branch instructions or assume access to private history.

Review approximately the previous two weeks of relevant changes, user discussions, failures, tests, original OBS evidence and captured XHR/fetch/API behaviour. Start with active, frequently used or high-friction workflows. Compare current source with newer delivered candidates and recorded user acceptance before calling an issue unresolved. A recent file timestamp or version number alone does not prove installation.

Find safe ways to reduce repeated actions, waiting, page loads, DOM work, polling, duplicate requests and manual recovery. Check existing state, data, shared helpers and proven APIs before proposing another mechanism. Never invent endpoints or treat an anecdote as evidence that an API works. Preserve intended differences between workflows.

Rank by practical user time saved, reliability, performance and recovery benefit, weighed against implementation risk. Correctness and data integrity are mandatory. Include only evidence-backed opportunities; separate confirmed defects from hypotheses and stylistic preferences. Avoid speculative rewrites and cleanup merely because code is old or unusual.

Read-only: do not modify production code, install, publish, commit/push, run operational mutations or add diagnostic instrumentation. Propose the smallest safe test when evidence is missing; use existing OBS capture where relevant. Never retry an uncertain state-changing action to gather evidence.

Return the strongest 1–3 opportunities, each with:

- Current: the user's present friction.
- Possible: the proposed improvement.
- Gain: the practical benefit; mark estimates.
- Evidence: current source/version and relevant original evidence.
- Proof needed: smallest safe test or missing observation.
- Risk: only material regression or operational risk.

Finish with one Best pick. Stop optional research once it cannot change the ranking, recommendation or material risk. If accessible evidence supports no worthwhile opportunity, say exactly: `No worthwhile discovery this cycle.` If required sources are unavailable, state the access limitation instead of presenting an incomplete review as a clean result.
