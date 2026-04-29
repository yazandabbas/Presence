# PRES-031: Add Repo-Brain Memory Schemas

Status: DONE
Milestone: 07-repo-brain
Owner: unassigned
Size: M
Risk: Medium
Parallel-safe: no
Upstream interference: Medium
Depends on: PRES-021, PRES-022

## Goal

Add schema-only contracts for repo-brain memory provenance, compiled truth, timeline evidence, trust modes, confidence, status, scope, and invalidation triggers.

## Why

The repo brain needs a stable typed boundary before server projection, markdown export, retrieval, or UI inspection can be implemented safely.

## Layer Boundary

Allowed:
- `packages/contracts/src/presence.ts`
- `packages/contracts/src/presence.test.ts`

Not allowed:
- Server projection logic
- Persistence migrations
- UI changes
- Runtime policy helpers
- Prompt changes

## Clean Architecture Rule

Contracts define shape only. They must not decide promotion policy, invalidation behavior, retrieval ranking, or supervisor briefing eligibility.

## Acceptance Criteria

- Schema includes memory kind, status, confidence, trust mode, scope, invalidation trigger, compiled memory, evidence entry, and provenance source references.
- Evidence entries require at least one durable source reference at the type or decode-validation boundary.
- Attempt-derived memory can represent ticket id and attempt id.
- Review-derived memory can represent review artifact id.
- File, command, test, and commit provenance can be represented.
- Rejected, stale, disputed, and historical states are representable.
- Schema tests cover valid roundtrips and invalid enum/value rejection.

## Completion Notes

Added additive repo-brain memory, evidence, promotion candidate, and promotion review contracts in `packages/contracts/src/presence.ts`, with focused roundtrip and invalid decode tests in `packages/contracts/src/presence.test.ts`. The contracts stay schema-only and separate from legacy knowledge-page and promotion-candidate records.

## Test Plan

Run `bun fmt`, `bun lint`, `bun typecheck`, and focused contract tests with `bun run --filter @t3tools/contracts test -- presence.test.ts`.

## Rollback

Remove the new schema definitions and tests.
