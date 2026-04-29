# PRES-038: Add Presence Operation Ledger

Status: DONE
Milestone: 04-runtime-observation
Owner: Codex
Size: L
Risk: High
Parallel-safe: no
Upstream interference: Medium
Depends on: PRES-032

## Goal

Add a durable, structured operation ledger for Presence itself so every important controller, supervisor, worker, reviewer, projection, command, and provider-runtime step can be inspected after the fact.

## Why

Presence cannot become trustworthy if failures are only visible as stale UI state, scattered logs, or inferred database rows. We need a single correlated timeline that explains what Presence tried, why it tried it, what it touched, what it skipped, how long it took, and what failed.

## Layer Boundary

Allowed:
- `packages/contracts/src/presence.ts`
- `packages/contracts/src/presence.test.ts`
- `apps/server/src/persistence/Migrations/**`
- `apps/server/src/presence/**`
- focused server tests

Not allowed:
- UI implementation
- Supervisor prompt injection
- Changing provider runtime behavior beyond emitting observation records
- Replacing mission events
- Free-form text-only logs as the source of truth

## Clean Architecture Rule

The ledger observes Presence operations. It must not decide policy, retry behavior, ticket status, promotion eligibility, or supervisor actions.

## Acceptance Criteria

- Ledger records have stable operation ids, parent operation ids, board id, ticket id, attempt id, review artifact id, supervisor run id, thread id, operation kind, phase, status, started/completed timestamps, duration, summary, structured details, counters, and error fields.
- Supported operation kinds include controller tick, goal planning, supervisor run, worker attempt, review run, command dispatch, provider runtime observation, projection sync, repo-brain projection, merge operation, and human direction.
- Each operation can record child steps without losing parent correlation.
- Idempotent operations use stable dedupe keys so replay does not create duplicate ledger entries.
- Failed/skipped operations include structured reasons that can be displayed without parsing logs.
- Ledger retention is bounded or explicitly documented.
- Mission events remain the product summary; the operation ledger is the detailed evidence trail.

## Test Plan

Run `bun fmt`, `bun lint`, `bun typecheck`, and focused ledger tests with `bun run --filter t3 test -- <targeted presence ledger tests>`.

## Rollback

Remove the ledger contracts, migration, store helpers, instrumentation hooks, and tests.
