# Pass 14 — explicit pending hierarchy acknowledgement

Problem: a hostname plus explicit PENDING/PROCESSING/QUEUED status was classified as CONFIRMED.
Correction: canonical hierarchy acknowledgement now rejects those three explicit nonterminal statuses as UNKNOWN. The existing empirical hostname acknowledgement remains unchanged; no new endpoint, success schema, ownership mechanism or automatic readback/retry was invented.
Evidence limit: native occurrence of these status fields is unestablished in accessible captures. This is a synthetic contradictory-response safety defect, not a claim that recorded native operations failed. Existing success:false/error/exception rejection preserved.
Verification: three source/generated Bind/Unbind failures reproduced; 50 hierarchy/Stow combined cases now pass. Pending operation survives Clear/repeated Run with one mutation only; native template capture uses the same validator; normal native acknowledgement still passes. Bind 0.1.4, Unbind/Stow 0.1.3 built because Stow bundles the shared driver.
Status: narrow approved fail-closed correction offline verified; native acknowledgement acceptance remains pending. Held pass 6 unchanged. Publication held.
