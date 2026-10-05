# OBS 0.1.2 validation

5 October 2026. Independent authored installer; no V2/V3 source import, runtime dependency or application mutation submitted.

`npm test`: **26 passed, 0 failed**. `npm run check`: **PASS**. Whitespace checks pass. Recovery preserved checkpoint `5d8ae2f61a18907f04d668a51347b1df34b06b5c` and all its 22 fixtures.

| Contract area | Offline evidence |
|---|---|
| Familiar interface | FCR header placement, OBS/FAT/Clear controls, build identity, normal 6,000 cap, FAT 50,000 setting and acceptance beyond 6,000, reset/reload initiation. Native tool/ISS pages collect without an added floating console. |
| Truth and identity | GM-only owner evidence reaches combined export; cross-document duplicates yield one operation phase; POST status/native HTTP success cannot become an operational phase; incomplete/invalid owner messages rejected. |
| Native transport | Fetch response and error objects preserved; repeated XHR return values/errors preserved; normal read aggregation; known cross-origin PO reads included. Supplementary body inspection cannot replace a native fetch result. |
| Recovery | Failed write/metadata read/notification/Clear/download retain visible errors and useful evidence. Failed FAT reset preserves mode. Clear rejects old buffers and cannot delete interleaved new-session worker writes. Corrupt stored evidence blocks partial export and can be cleared. Enumeration recovery permits export without a new event; late fetch completions and queued summaries cannot cross Clear/BFCache boundaries. |
| Lifecycle | Header replacement keeps one control; pagehide restores hooks and removes listeners/timers/styles; BFCache restores one collector; export object URLs and oversized sampling branches are released. HTTP pages work without secure-context randomUUID. |
| Independence / low noise | Installer runs alone; no old global/library/event/storage use found; sanitized tokens/raw payloads; no idle intervals or background requests. |

The tests run the actual installer in jsdom, with explicit GM/shared-storage, clock, download and native transport fixtures. They establish fixture behaviour, not browser-world equivalence or actual Amazon operational success. FAT's full 50,000-event boundary was not filled; the normal boundary and FAT acceptance beyond normal capacity were exercised.

Live checks outstanding: page-world hook access in Tampermonkey, deployed FCR header timing, cross-origin frame GM notifications, actual browser file download, and longer real idle/use. Native telemetry is observation only; mutation confirmation belongs to each future workflow's positive response/reconciliation contract. Browser download initiation does not prove a file was saved.

Source/state corrections during this unit are internal: one atomic session/mode record, epoch-specific shard keys, explicit operation identity validation and cleanup. Proven control location/sequence remains the contract. Subsequent units use this collector optionally and emit their own evidence; they never depend on OBS to execute.

Two additional failures were reproduced against the recovered 0.1.1 checkpoint before correction: an old fetch could enter a new session after Clear/BFCache, and a FAT body constructor getter could reject an otherwise successful native fetch. Requests now retain their original epoch and lifecycle signal; instrumentation is isolated from native results. Session changes cancel response-clone readers. The 0.1.2 corrections preserve the recovered atomic mode/shard storage and stronger validation.
