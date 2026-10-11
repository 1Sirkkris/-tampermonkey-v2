# Pass 16 — Measurement cold acquisition

Problem: four compatible cold reads created four authentication frames/listeners inside one provider.
Correction: one per-provider acquisition owns the frame/listener; compatible subscribers retain individual cancellation/deadlines. Last cancellation closes acquisition. Different rejected-token requirements, forced native recaptures and separate runtime owners stay separate. No cross-script dependency or global owner was introduced.
Evidence: Sep 23 native renewal evidence in the original review proves outgoing native token capture worked; it does not prove this sharing change. New actual source fixtures reproduce frame duplication and verify cancellation, staggered deadlines, storage errors, synchronous notifications, incompatible/forced requests and separate owners. Native token validation, renewal and raw API checks preserved.
Verification: 105 combined auth/enrichment/Master/native/Tote/suite tests pass, including generated Master and Tote integration. Metadata/canonical builds selectively generated for Master 0.1.7 and Tote 0.1.3; source capability version 0.1.3. Four compatible source calls now use one frame/listener, measured in fixtures only. No live speed claim.
Status: OFFLINE VERIFIED — LIVE GATE PENDING. Cold/expired native authentication acceptance remains pending. Publication held.
