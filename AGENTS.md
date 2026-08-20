# Repository working rules

Apply priorities in this order: Correctness → Safety → Intended behaviour → Reliability → Performance → Cleanup.

- Work in this source-of-truth repository. The closest `AGENTS.md` governs a file. Preserve unrelated and user-owned changes.
- Fix proven problems, not theories. Preserve external contracts and compatibility: userscript metadata, APIs, payloads, endpoints, storage keys, selectors, shortcuts, URLs, labels, events, persisted preferences, and normal workflows.
- Never guess an API contract or internal-site behaviour, and never claim an unmeasured performance gain.
- For existing code, establish the affected workflow and invariants, identify the root cause, make the minimum useful change, and verify Trigger → Action → Result with relevant tests. Require live validation when static proof is insufficient.
- Review adjacent workflow only when requested or directly affected. Do not re-audit unchanged files or expand focused work into a fleet-wide audit.
- Tests should protect behaviour and external contracts, not helper names, function counts, formatting, or other implementation trivia.
- For live evidence, state the exact claim and capture only what is necessary. Never collect credentials, cookies, tokens, auth headers, sensitive headers, or unnecessary identifiers. Create sanitized fixtures only from known evidence; do not invent responses.
- Keep current scripts independently usable and preserve supported browser/userscript compatibility. Do not edit, rebuild, or replace deployment or work-laptop packs unless explicitly requested and separately verified.
- Commit and push authorization are separate. Before a commit, inspect status and diff, stage only exact intended paths, run proportionate validation, and preserve a clean, recoverable state. Never merge or publish without explicit authorization.
