# BWU2 Tampermonkey V3 — Relaunch

Branch: `v3-relaunch`

V3 is rebuilt around native-page ownership and shared engines.

## Rules

- V2 `main` is never modified by V3 work.
- Old `v3-rebuild` is reference only.
- Source may share modules; installed userscripts are self-contained.
- No runtime `@require`.
- Native Amazon pages remain native unless a dedicated console is genuinely better.
- FCResearch is a light toolbox, not the home of every workflow.
- ISS Console is an independently installed app hosted on Poirot at `#iss-console`; FCResearch must never `@require` or bundle it.
- Sideline inside ISS Console runs locally on Poirot. Do not resurrect a hidden FCResearch Sideline worker.
- ISS Console owns fast repeated ISS workflows: Edit, Move, Sideline and FCSKU.
- Native Edit/Move/Sideline/Hierarchy/MoveContainer pages remain usable with their own V3 helpers.
- One mutation engine per backend. Multiple UIs call the same engine.
- A submitted mutation may only finish CONFIRMED, REJECTED or UNKNOWN.
- UNKNOWN never auto-retries.
- No free-text employee identity when authenticated identity can be proven.
- UI boots lazy; network work starts only when a feature asks for it.
- All V3 UI participates in one shared dock/panel contract.
- OBS receives sanitized structured events from the real operation/transport layer.
