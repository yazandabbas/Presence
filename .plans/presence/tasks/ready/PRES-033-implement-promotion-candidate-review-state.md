# PRES-033: Implement Promotion Candidate Review State

Status: READY
Milestone: 07-repo-brain
Owner: unassigned
Size: M
Risk: High
Parallel-safe: no
Upstream interference: Medium
Depends on: PRES-022, PRES-032

## Goal

Implement the review lifecycle for repo-brain promotion candidates: accept, edit, reject, stale, disputed, and historical.

## Why

Presence should propose memory, not silently rewrite durable repo truth. The lifecycle needs to be explicit before markdown export or retrieval uses memory.

## Layer Boundary

Allowed:
- `apps/server/src/presence/**`
- `packages/contracts/src/presence.ts` only if PRES-031 left a concrete gap
- focused server tests

Not allowed:
- Markdown export
- UI inspection beyond stable API shape
- Supervisor prompt injection
- Auto-promoting candidates

## Clean Architecture Rule

Review state transitions gate durable memory. They must not change ticket lifecycle, attempt state, review decisions, merge readiness, or blocker state.

## Acceptance Criteria

- Candidate flow supports `candidate -> accepted | edited | rejected | disputed | historical`.
- Accepted or edited memory can later become stale, disputed, or historical.
- Rejected candidates remain durable enough to prevent repeated identical proposals.
- Edit-and-accept creates reviewed compiled memory linked to the source candidate and evidence.
- Transition legality is enforced and tested.
- Rejected, disputed, stale, and historical memories are excluded from default supervisor briefing eligibility.

## Test Plan

Run `bun fmt`, `bun lint`, `bun typecheck`, and focused server lifecycle tests with `bun run --filter t3 test -- <targeted promotion candidate tests>`.

## Rollback

Remove the lifecycle service/API changes and tests.
