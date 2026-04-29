# PRES-040: Add Presence Observability Regression Suite

Status: DONE
Milestone: 08-release-readiness
Owner: Codex
Size: M
Risk: Medium
Parallel-safe: no
Upstream interference: Low
Depends on: PRES-038, PRES-039

## Goal

Add regression coverage that proves Presence emits enough observable evidence during normal work, replay, failure, retry, and recovery paths.

## Why

An observability system can rot quietly. Presence needs tests that fail when an important path stops emitting ledger events, loses correlation, hides errors, or creates duplicate traces after replay.

## Layer Boundary

Allowed:
- focused server tests
- focused web/view-model tests
- test helpers and fixtures
- manual smoke checklist documentation if needed

Not allowed:
- Broad runtime refactors
- New production behavior except small testability hooks that are also useful for diagnostics

## Clean Architecture Rule

Tests assert externally meaningful observability outcomes, not private implementation trivia.

## Acceptance Criteria

- Happy-path goal planning, worker handoff, review, projection, and repo-brain projection all produce correlated ledger traces.
- Provider/auth unavailable paths produce failed or blocked operations with actionable reasons.
- Replay/reconnect does not duplicate operation traces.
- Interrupted or killed threads produce terminal operation states rather than hanging forever.
- Slow/stalled operations expose age and waiting reason.
- UI observability summaries render active, failed, skipped, and recovered states.
- A manual smoke checklist explains what the maintainer should see during a real Presence run.

## Test Plan

Run `bun fmt`, `bun lint`, `bun typecheck`, targeted observability tests, and `bun run test` when the full suite can complete in the local environment.

Completed targeted coverage:
- Server ledger regression covers replay dedupe, provider/auth unavailable evidence, and terminal workspace cleanup operations.
- Web view-model regression covers active, failed, skipped, cancelled, aged running, empty, and ticket-scoped operation summaries.
- Manual smoke checklist: `.plans/presence/audits/PRES-040-observability-smoke-checklist.md`.

## Rollback

Remove the regression tests and smoke checklist.
