# Pass 12 — Screenshot detached styles

Problem: a V4 stylesheet detached while hidden kept media='not all'; reattaching after Ctrl+Q could leave its UI unstyled.
Correction: restore exact original media on every captured style object at exit/disposal, whether currently connected or detached, then release tracking. One canonical restore path; no native style or focus changes.
Verification: four source/generated exit/disposal failures reproduced; 8 Screenshot/shared-footer integration fixtures pass. Existing newly mounted styles, native style/focus and BFCache checks retained. Screenshot 0.1.1 built. Offline DOM checks, not native visual proof.
Status: offline verified; cross-page native visual acceptance pending; publication held.
