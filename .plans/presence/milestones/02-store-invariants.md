# 02: Store Invariants And Idempotency

## Goal

Make Presence persistence the trusted continuity kernel: one active attempt per ticket, one active supervisor lease per board, idempotent mission events, recoverable merge operations, and deterministic projection repair.

## Why

Long-horizon agent behavior only becomes safe if the store prevents duplicate work and preserves evidence under crashes, reconnects, and retries.

## Outcomes

- DB constraints and service-level guards agree.
- Duplicate starts become no-ops or deterministic recovery paths.
- Mission events are deduped by stable keys.
- Projection repair can be retried without corrupting state.

## Backlog

- Audit all write paths for idempotency keys.
- Add restart-style tests for active attempt recovery.
- Add duplicate supervisor-run tests.
- Normalize mission event dedupe keys.
- Clarify or remove orphaned deterministic job domain.

