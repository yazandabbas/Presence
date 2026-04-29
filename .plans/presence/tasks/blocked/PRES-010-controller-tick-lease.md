# PRES-010: Controller Tick Lease

Status: BLOCKED
Milestone: 03-resident-controller
Owner: unassigned
Size: M
Risk: Medium
Parallel-safe: no
Upstream interference: Low
Depends on: PRES-009

## Goal

Each controller tick must claim a durable board-scoped lease before doing work and skip work when another live lease owns the board.

## Why

Presence should tolerate duplicate server processes, restart races, and queued ticks without duplicate supervisor decisions.

## Layer Boundary

Allowed:
- `apps/server/src/presence/Layers/PresenceControllerService.ts`
- `apps/server/src/presence/Layers/internal/PresenceStore.ts`
- controller/store tests

Not allowed:
- Web UI
- Provider code
- Prompt code
- New migrations unless existing lease columns are insufficient

## Clean Architecture Rule

The controller may decide when a tick can run. It must not encode worker/reviewer business policy inline.

## Acceptance Criteria

- Tick acquires a board-scoped lease before action.
- A second tick skips while lease is active.
- Expired lease can be reclaimed.
- Lease owner and expiry are visible through controller state.
- Tests use fake clock or deterministic timestamps.

## Test Plan

Run focused controller tests and `bun typecheck`.

## Rollback

Revert lease logic and tests. Do not leave partial lease semantics in UI.
