# Pass 13 — SIM known-invalid image replies

Problem: a login/error/non-image reply still triggered the raw-link fallback.
Correction: one typed content/HTTP rejection distinguishes known-invalid replies from transport-only fetch failures. Valid image blobs and existing same-origin direct fallback remain; cross-origin/cancelled fallback remains prohibited. No retries were added.
Behaviour difference: HTTP401/404, HTML/login, empty blobs and non-image MIME replies now report failure without opening/downloading their raw URL. This includes application/octet-stream responses which have not proved they are images. A legitimate same-origin image whose scripted transport fails can still be handed directly to the browser. Browser handoff is not proof a file was saved; no byte-level image decoder was introduced.
Evidence: V2 deliberately supported raw fallback (original current-state review, KB ISS-025); approval changes only known-invalid cases. Six new actual source/installer cases distinguish content, transport, valid blob, cross-origin and cancellation. Two original content failures reproduced; initial test cleanup error was corrected in the fixture, not operational code.
Verification: 26 SIM source/generated cases pass, including existing snippets/toolbar/gallery/lifetime cases. SIM 0.1.3 built. Native legitimate downloads/auth still need live acceptance; no publishing.
Status: narrow approved behaviour corrected offline; publication held.
