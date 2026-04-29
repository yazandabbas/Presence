# PRES-041: Canonicalize Runtime Correlation Keys

Status: Done

## Goal

Centralize Presence correlation and dedupe key construction so runtime replay, review sessions, merge operations, mission events, operation ledger rows, and repo-brain evidence all use the same stable vocabulary.

## Implementation

Added a focused `PresenceCorrelationKeys` helper under the server Presence internals. The helper keeps string normalization, runtime event replay dedupe keys, mission dedupe keys, operation ledger dedupe keys, operation scopes, workspace cleanup keys, and thread-correlation source names in one pure module.

Runtime observation now reuses the shared runtime replay key builder. Mission control, worker attempt setup, review kickoff/result/failure handling, supervisor active-thread correlation, operation ledger writes, merge operation evidence, review artifact evidence, and cleanup ledger writes all route through the canonical builders rather than handwritten strings.

## Regression Coverage

Added unit coverage for key normalization and runtime replay identity. Extended thread-correlation tests to cover review artifact ownership remaining sticky across later review requeues. Extended operation-ledger coverage so mission events preserve attempt and thread correlation fields while deduping replayed failures.

## Validation

Focused validation passed with `bun run --filter t3 test -- PresenceCorrelationKeys.test.ts PresenceThreadCorrelationStore.test.ts PresenceOperationLedger.test.ts`.
