# PRES-003: Add Presence Schema Roundtrip Tests

Status: DONE
Milestone: 01-contract-state-integrity
Owner: Codex
Size: M
Risk: Medium
Parallel-safe: yes
Upstream interference: Medium
Unblocked by: PRES-002

## Goal

Add focused schema encode/decode tests for the highest-value Presence public inputs and read models.

## Why

Presence depends on durable compatibility. Optional fields, defaults, branded IDs, and nested read models must survive RPC and persistence boundaries.

## Layer Boundary

Allowed:
- `packages/contracts/src/presence.test.ts`
- `packages/contracts/src/presence.ts` only for missing defaults discovered by tests

Not allowed:
- Server service changes
- Web component changes

## Clean Architecture Rule

Tests may validate schemas but must not encode business policy outside the server domain.

## Acceptance Criteria

- Tests cover `PresenceSubmitGoalIntakeInput`, `BoardSnapshot`, `PresenceMissionEventRecord`, `SupervisorRunRecord`, `WorkerHandoffRecord`, `ReviewArtifactRecord`, and controller state.
- Backward-compatible decode cases cover omitted optional mission/controller fields.
- Invalid enum values fail decoding.
- No runtime helpers are added to contracts.

## Test Plan

Run:
- `bun run --filter @t3tools/contracts test src/presence.test.ts`
- `bun typecheck`

## Rollback

Revert tests and any schema-default changes.
