# Sanitized replay fixtures

These fixtures contain no captured production data. Every field and branch is already recognized by the current source:

- `sideline.responses.json` exercises `resolveItem`, `moveOk`, `moveReason`, `hasPredicant`, `isDamagedDestinationResponse`, and the known payload builders.
- `aft.responses.json` exercises `objectId` and documents the `/status` states and quantity patterns already hard-coded by AFT.
- `dropzone.states.json` exercises `normalizeContainer` and the existing status/error partitions.
- `bin-hierarchy.responses.json` exercises `parseFloor`, `unknownFloor`, and `numericQuantity` using the current hierarchy-cell selector contract.
- `data-core.responses.json` exercises `parseBool`, `suspiciousDimensions`, and `normalizeProduct`.

Do not add a fixture for an unknown response until it has been captured, sanitized, and tied to the exact production parsing branch that consumes it.
