# PRES-037: Add Repo-Brain End-To-End Regression Tests

Status: READY
Milestone: 07-repo-brain
Owner: unassigned
Size: M
Risk: Medium
Parallel-safe: no
Upstream interference: Low
Depends on: PRES-032, PRES-033, PRES-034, PRES-035, PRES-036

## Goal

Add focused regression tests proving repo-brain memory remains a projection from evidence and never becomes orchestration truth.

## Why

Memory infrastructure can fail quietly. Regression coverage should lock down provenance, promotion, stale handling, retrieval citations, and UI inspection before the feature is trusted.

## Layer Boundary

Allowed:
- focused server tests
- focused web tests
- focused contract tests if gaps remain

Not allowed:
- New product behavior
- Broad Presence refactors
- Snapshot-heavy tests that obscure behavior

## Clean Architecture Rule

Tests should assert the boundary: evidence creates candidates, review promotes durable truth, invalidation changes memory status, retrieval cites sources, and orchestration state still wins.

## Acceptance Criteria

- Events create candidates with durable source citations.
- Review can promote, edit, reject, dispute, stale, and mark historical.
- Rejected candidates do not reappear as prompt-eligible truth.
- File or review invalidation marks accepted memory stale or disputed.
- Retrieval excludes non-briefing-safe memory by default and returns citations.
- UI renders provenance and status labels for active, stale, disputed, denied, and historical states.
- A regression proves memory cannot alter ticket lifecycle, merge readiness, review decision, or active attempt identity.

## Test Plan

Run `bun fmt`, `bun lint`, `bun typecheck`, and targeted `bun run test` suites. Never run `bun test`.

## Rollback

Remove the regression tests.
