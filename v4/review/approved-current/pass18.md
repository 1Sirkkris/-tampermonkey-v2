# Pass 18 — PO retired mask ownership

Problem: result replacement retained retired vendor/header cells until route closure.
Correction: canonical result reconciliation restores/releases disconnected owned cells; disposal releases the active collection. Exact replacement/cloned V4 masks become owned by the current table so Full Portal/disposal can restore them. No table data/filter/date/search change.
Verification: source and generated replacement fixtures both failed originally. After 25 replacements, 50 retired cells are restored/released during reconciliation, disposal does not touch them again, active Full Portal masking/restoration still works. Five PO normal/source/installer fixtures pass. PO 0.1.1 built. Browser heap/speed improvement was not measured; the reduction is retained node references in fixtures.
Status: offline verified; native PO markup/visual acceptance pending; publication held.
