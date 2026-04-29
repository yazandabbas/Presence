# PRES-008: Test Supervisor Run Idempotency

Status: DONE
Milestone: 02-store-invariants
Owner: Codex
Size: M
Risk: Medium
Parallel-safe: no
Upstream interference: Low

## Goal

Prove that starting or retrying supervisor runs cannot create duplicate active runs for the same board/scope.

## Why

The supervisor is the highest-authority Presence actor. Duplicate supervisor runs can create duplicate reviewers, repeated continuations, and contradictory mission state.

## Layer Boundary

Allowed:
- `apps/server/src/presence/Layers/internal/PresenceSupervisorRuntime.ts`
- `apps/server/src/presence/Layers/internal/PresenceSupervisorRuntime.test.ts`
- `apps/server/src/presence/Layers/internal/PresenceStore.ts` only if a store bug is found

Not allowed:
- UI changes
- Prompt changes
- New RPC methods

## Clean Architecture Rule

Supervisor ownership must be enforced durably, not by in-memory flags.

## Acceptance Criteria

- Done: starting a supervisor while an active same-scope run exists returns the existing run.
- Done: same-scope duplicate starts do not persist a second run, write a new handoff, or launch another detached executor.
- Done: cross-scope active-run behavior is explicitly tested and fails with a human-actionable scope error.
- Done: the existing unique-constraint race test still proves concurrent same-scope recovery does not launch duplicate review or worker work.

## Test Plan

Run:
- `bun run --filter @t3tools/server test src/presence/Layers/internal/PresenceSupervisorRuntime.test.ts`
- `bun typecheck`

Validated with:
- `bun run test src/presence/Layers/internal/PresenceSupervisorRuntime.test.ts`
- `bun run typecheck` in `apps/server`

## Rollback

Revert supervisor runtime/test changes.
