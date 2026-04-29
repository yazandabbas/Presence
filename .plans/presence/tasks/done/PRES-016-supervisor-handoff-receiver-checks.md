# PRES-016: Supervisor Handoff Receiver Checks

Status: DONE
Milestone: 05-agentic-loops
Owner: Codex
Size: M
Risk: Medium
Parallel-safe: yes
Upstream interference: Low
Unblocked by: PRES-014

## Goal

Validate supervisor handoff inputs against current board state before using them for orchestration decisions.

## Why

Handoffs can become stale. The supervisor must re-anchor to saved state and not trust old summaries over current tickets, findings, and mission events.

## Layer Boundary

Allowed:
- `apps/server/src/presence/Layers/internal/PresenceBoardService.ts`
- `apps/server/src/presence/Layers/internal/PresenceSupervisorRuntime.ts`
- focused tests

Not allowed:
- UI changes
- Memory projection changes
- Provider runtime changes

## Clean Architecture Rule

Current persisted state wins over handoff text when they disagree.

## Acceptance Criteria

- Done: handoff active attempt IDs are checked against current attempts and terminal/stale/out-of-scope attempts are classified.
- Done: blocked ticket IDs are checked against current ticket statuses and open blocking findings.
- Done: stale or contradictory handoffs create deduped `runtime_warning` mission events.
- Done: supervisor execution writes warnings before proceeding from the current board snapshot.

## Test Plan

Run focused board/supervisor tests and `bun typecheck`.

Validated with:
- `bun run test src/presence/Layers/internal/PresenceSupervisorRuntime.test.ts --testNamePattern "handoff"`
- `bun run typecheck` in `apps/server`

## Rollback

Revert validation logic and tests.
