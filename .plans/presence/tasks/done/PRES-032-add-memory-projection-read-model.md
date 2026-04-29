# PRES-032: Add Memory Projection Read Model

Status: DONE
Milestone: 07-repo-brain
Owner: unassigned
Size: L
Risk: High
Parallel-safe: no
Upstream interference: Medium
Depends on: PRES-031

## Goal

Project existing Presence evidence into read-only repo-brain memory candidates and timeline evidence records.

## Why

Memory must be derived from durable evidence instead of free-floating agent summaries. The first runtime step should capture candidate evidence without promoting anything to compiled truth.

## Layer Boundary

Allowed:
- `apps/server/src/presence/**`
- persistence migration only if needed for a read model
- focused server tests

Not allowed:
- Auto-promotion
- Markdown writes
- Retrieval ranking
- UI changes
- Supervisor prompt injection
- Replacing existing mission event, ticket, attempt, or review flows

## Clean Architecture Rule

The read model is a projection. It consumes mission events, tickets, attempts, handoffs, findings, reviews, files, commands, and tests; it does not become the source of orchestration truth.

## Acceptance Criteria

- Mission events can produce timeline evidence with stable dedupe keys.
- Worker handoffs can produce bounded lesson/risk candidates with source attempt and ticket ids.
- Review artifacts can produce candidate evidence with review artifact ids.
- File paths, commands, tests, and commit shas are preserved when available.
- Projection is idempotent across replay and restart.
- Failed attempts cannot produce current implementation facts without review-derived evidence.
- Candidate records remain read-only and unpromoted.

## Completion Notes

Added a read-only repo-brain SQL projection that derives evidence and unpromoted candidates from mission events, worker handoffs, findings, merge operations, and review artifacts. The read model uses stable source dedupe keys, preserves ticket, attempt, review, file, command, test, finding, merge operation, and commit provenance when available, and never promotes candidates into compiled memory.

## Test Plan

Run `bun fmt`, `bun lint`, `bun typecheck`, and focused server projection tests with `bun run --filter t3 test -- <targeted presence memory tests>`.

## Rollback

Remove the read model projection, migration, and focused tests.
