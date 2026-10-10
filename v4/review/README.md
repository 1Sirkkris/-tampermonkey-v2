# Root review — unpublished Sideline expiry proposal

Status: WIP — active runtime correction NOT APPLIED / NOT APPROVED. The user explicitly prioritised a critical override on 10 October; its exact wording is absent from both accessible attachments. The worker holds runtime/expiry/safety/UI behavior edits and installer publication pending that text. Tests/documentation/checkpoints and concrete isolated proposals continue. No live operational action was performed.

## Demonstrated root causes

| Issue | Actual-source/generated reproduction | Minimal proposed correction |
|---|---|---|
| Expiry answer has the wrong owner/scope | Choose date for an item from source A; change to source B and scan 123START. Both the actual UI/workflow and generated native client send the old answer without a new-source prompt. A new source explicitly reporting NONE still receives the old date. | One workflow-owned answer map keyed by source, barcode, exact ASIN/FNSKU/FCSKU and native prompt/shelf-life context; consult it only when the current native response requires a date. Remove the UI's separate dateAnswered set and consult that same owner. Preserve same-source repeated-scan reuse. |
| Date modal below owned panels | Actual scoped CSS: modal z-index 1000010; Sideline panels 2147483645 and dock 2147483646. | Set the canonical shared picker overlay to 2147483647, above the owned panels. No styling override layer or native page reset. |

`sideline-expiry.repro.test.mjs` asserts desired behavior against actual imported source and the actual generated installer. Current published code: **1 pass / 4 fail**, zero skipped/cancelled. These are offline synthetic native responses, not live observations. The positive control verifies one answer still covers two physical scans of the same item/source; the generated negative verifies scanner START through the real bundled client and payload path.

`SIDELINE_EXPIRY_PROPOSAL.patch` is a concrete unapplied patch to only `sideline-workflow.mjs`, `sideline-runtime.mjs`, and `date-picker.mjs`. In an isolated copy it passes **346 retained regression cases + all 5 review cases**, deterministic build and all 19 installer/69 module checks. Versions remain original because this copy is not a release. Active source/installers remain byte-for-byte unchanged. Shared source would affect Sideline and ISS bundles if approved; both need version bumps and regenerated tests at that point.

The proposal removes one redundant dateAnswered set and its independent mutation rules. The stronger context key/finite-answer guard adds code: net +425 bytes across the three source modules. This is simpler date ownership, not a measured performance or size optimisation.

## Reproduce without changing a candidate

From the repository root:

```sh
node --test v4/review/sideline-expiry.repro.test.mjs
# Expected on current source: 1 pass / 4 fail.
cd v4
npm test
npm run check
# Existing regression baseline: 346 pass, builds unchanged.
```

To review the proposal in an isolated checkout (never apply directly to the active branch before the override is resolved):

```sh
git worktree add --detach ../v4-review HEAD
cd ../v4-review
git apply /absolute/path/to/active/repo/v4/review/SIDELINE_EXPIRY_PROPOSAL.patch
cd v4
npm ci --ignore-scripts
npm run build
npm test
npm run check
node --test review/sideline-expiry.repro.test.mjs
# Proposal: retained 346 + targeted 5 pass. No network/native operational API used.
```

## Contract/evidence and review coverage

Reviewed responsibility/condition chains: `sideline-client`, `sideline-preflight`, `sideline-workflow`, `sideline-runtime`, `sideline-native`, `date-picker`, and the ISS date handoff/worker integration. Canonical identity and UI helpers were inspected only where these chains depend on them; do not call that a full review of those modules. Other workflow root reviews remain outstanding. No claim that every suite line has been assessed.

Retain: native expirationPromptType gating; exact item identity; hazard/overage gates; production/shelf-life conversion; date cancellation before movement; request identities; one native owner; durable submitted/unknown barriers; two-stage Stop; same-run repeated-item reuse; optional OBS. Broad native form/shadow-root fallbacks need real markup before removal. No transport, mutation proof, ownership, scanner sequence, native location or quantity rule is changed by this proposal.

V2 evidence: `resetPreflightWorkflowState` clears its date cache and date queue; `pumpPreflightDates` documents one question per distinct barcode per run. V4's UI already deduplicates answers by source/code but its workflow stores by code only: conflicting date ownership is the reproduced root cause. Only native NONE means the new-source item has no expiry prompt in the explicit second reproduction.

PAO remains unresolved policy/evidence, not an implemented change: V2 `paoDateMs` and current V4 add 900 calendar days from today, while user SOP context describes receive-date based PAO when expiry is not printed. Current UI provides a manual PAO button for an expiration prompt. Native PAO eligibility/receive-date provenance and the intended approved rule need clarification before changing the button, date arithmetic, or prompt conditions. No PAO policy is guessed or removed.

## Exact next action

Obtain the exact critical override. Reconcile it with the unapplied proposal; request any functional/safety/UI approval it requires. If authorised, apply this concrete patch, promote the five reproductions into the normal regression suite, bump Sideline/ISS versions, build/check/test, update readiness and push a verified checkpoint. Then continue root review of native operation queues and other BASELINE workflows. Empty-container location and legitimate additional AFT Confirm contracts remain unavailable; do not invent them.
