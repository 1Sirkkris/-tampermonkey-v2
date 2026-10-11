# Pass 15 — accepted START feedback

Problem: while ownership was pending, Sideline had accepted START but its Run button/status still looked ready.
Correction: canonical workflow notifies its existing busy state immediately with 'Waiting for workflow owner'. No second state owner/timer, scanner delay or new operation is introduced. Shared ISS native worker receives the same truthful state.
Verification: both source and actual installer reproduced the enabled/Ready display before correction; both now pass. 81 combined Sideline/ISS/suite fixtures pass, including cancellation before ownership and all prior date/native/Predicant/UNKNOWN cases. Sideline/ISS 0.1.7 built. Offline only; no live operation.
Status: verified offline; publication held.
