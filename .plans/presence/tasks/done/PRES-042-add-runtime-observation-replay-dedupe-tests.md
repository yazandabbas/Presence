# PRES-042: Add Runtime Observation Replay Dedupe Tests

Status: Done

## Goal

Make Presence runtime observation safer under reconnect and replay by proving that duplicated provider events do not create duplicate mission evidence, while later repeated failures remain visible.

## Implementation

Tightened payload-fallback runtime dedupe keys so they include the provider event timestamp alongside type and payload. This keeps replayed events stable when only the transient event id changes, but avoids hiding a real second identical failure that happens later on the same thread.

Added focused regression coverage for provider reference priority, payload-fallback replay behavior, later repeated failures, and the live `PresenceObservationService.start()` stream consumer path. The live consumer test seeds a thread correlation, publishes duplicate provider runtime events through a fake `ProviderService.streamEvents`, and verifies that Presence writes a single mission event row.

## Validation

Focused validation passed with `bun run --filter t3 test -- PresenceObservationService.test.ts PresenceCorrelationKeys.test.ts PresenceThreadCorrelationStore.test.ts PresenceOperationLedger.test.ts`.
