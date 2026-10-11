# Pass 7 — Bind template acknowledgement

Problem: passive native Bind capture saved opaque warehouse tokens even when the response explicitly rejected Bind; seed completion also saved the same template twice.
Correction: template capture uses the existing canonical acknowledgement validator before saving. Passive finish is the single template publisher; seed still independently validates its result and exact request tokens. No changes to held concurrency/manual owner policy (pass 6).
Verification: source and generated installer both reproduced rejected template saves; now reject success:false/error/errorMessage/exception/blank-host, HTTP500 and redirect while retaining normal native tokens. Seed fixture now proves one template save instead of duplicate writes. 20 hierarchy source/installer tests pass. Bind 0.1.3 built. OBS history supports existing native token/protocol use, not this synthetic rejection case; no live hierarchy action.
Status: offline verified; native hierarchy acceptance pending; publication held.
