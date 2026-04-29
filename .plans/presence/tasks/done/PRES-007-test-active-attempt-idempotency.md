# PRES-007: Test Active Attempt Idempotency

Status: DONE
Milestone: 02-store-invariants
Owner: Codex
Size: M
Risk: Medium
Parallel-safe: no
Upstream interference: Low

## Goal

Ensure repeated start/create paths for the same ticket recover or no-op instead of creating duplicate active attempts or threads.

## Why

Duplicate work was one of the most visible Presence trust failures. The DB constraints exist; the service behavior must prove recovery paths are deliberate.

## Layer Boundary

Allowed:
- `apps/server/src/presence/Layers/internal/PresenceAttemptService.ts`
- `apps/server/src/presence/Layers/internal/PresenceAttemptService.test.ts`
- `apps/server/src/presence/Layers/PresenceControlPlaneTestSupport.ts`

Not allowed:
- UI changes
- Prompt changes
- Provider adapter changes

## Clean Architecture Rule

Attempt idempotency belongs in server store/service logic, not in frontend button disabling.

## Acceptance Criteria

- Done: repeated attempt creation for an active ticket fails with a human-actionable Presence error.
- Done: repeated session kickoff after partial thread claim reuses or repairs the claimed thread.
- Done: tests cover missing thread, running claimed thread, concurrent claim, partial kickoff failure, and settled claimed thread.
- Done: error messages tell the user whether to reuse, resolve, retry after startup settles, or wait for the runtime.

## Test Plan

Run:
- `bun run --filter @t3tools/server test src/presence/Layers/internal/PresenceAttemptService.test.ts`
- `bun typecheck`

Validated with:
- `bun run test src/presence/Layers/internal/PresenceAttemptService.test.ts`
- `bun run typecheck` in `apps/server`

## Rollback

Revert service/test changes.
