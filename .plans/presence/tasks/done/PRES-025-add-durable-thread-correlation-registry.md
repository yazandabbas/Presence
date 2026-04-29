# PRES-025: Add Durable Thread Correlation Registry

Status: DONE
Milestone: 04-runtime-observation
Owner: Codex
Size: L
Risk: High
Parallel-safe: no
Upstream interference: Medium
Unblocked by: PRES-004

## Goal

Add a durable registry that records which Presence board, role, ticket, attempt, review artifact, or supervisor run owns each runtime thread.

## Why

Observation currently correlates provider and orchestration events mostly through thread ids and fallback heuristics. That works for happy paths, but it is too easy to misattribute replayed events, stale mission events, or supervisor active-thread JSON matches. A thread correlation registry gives Presence a stable source of truth before it turns runtime activity into mission evidence.

## Layer Boundary

Allowed:
- new Presence migration
- `apps/server/src/presence/Layers/internal/PresenceStore.ts`
- worker attempt thread attach/start paths
- review session create/attach paths
- supervisor active-thread persistence paths
- focused observation/store tests

Not allowed:
- UI changes
- provider adapter rewrites
- broad `BoardSnapshot` changes
- removing current fallback correlation until backfill/migration behavior is proven

## Clean Architecture Rule

Thread ownership belongs in the Presence persistence layer. Observation may read ownership and translate events, but it must not infer long-lived ownership from event text, thread id prefixes, or UI state.

## Acceptance Criteria

- A `presence_thread_correlations` table or equivalent durable store exists, keyed by `thread_id`.
- The registry records `board_id`, `role`, optional target ids, source, created time, and updated time.
- Worker, review, and supervisor thread creation/attachment paths write the registry.
- `readPresenceThreadCorrelation` reads the registry first and only falls back to legacy heuristics for migration/backfill.
- Tests prove supervisor thread lookup does not false-match substring thread ids.
- Tests prove replayed provider/domain events correlate through the registry and do not create duplicate product-visible mission events for the same stable source event.

## Test Plan

Run focused Presence store/observation tests and then:
- `bun typecheck`

## Completion Notes

Implemented as a narrow Presence persistence change. The registry now records thread ownership durably, worker/review paths write ownership when threads are created or attached, supervisor persistence annotates known active threads, and legacy supervisor fallback now checks exact JSON membership instead of substring matches.

Validation completed on Windows:
- `bun fmt` passed.
- `bun lint` passed with existing warnings and 0 errors.
- `bun typecheck` passed across the monorepo.
- Focused Presence correlation and observation tests passed.
- `apps/web` package tests passed independently.
- `apps/desktop` package tests passed independently.

Root `bun run test` was attempted multiple times. It hit timing-sensitive failures outside the server correlation change: first `apps/desktop/src/backendReadiness.test.ts`, then `apps/web/src/localApi.test.ts` and `apps/web/src/components/presence/PresenceDashboard.test.tsx`. Each failing test or package passed when rerun independently. A root run with constrained Turbo concurrency timed out after 20 minutes. Treat this as a Windows monorepo test-runner reliability issue to investigate separately rather than a blocker for this task.

## Rollback

Revert the migration, store API, call-site writes, and tests. Legacy correlation fallbacks should continue to work during rollback.
