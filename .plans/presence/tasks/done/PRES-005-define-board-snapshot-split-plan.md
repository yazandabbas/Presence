# PRES-005: Define Board Snapshot Split Plan

Status: DONE
Milestone: 01-contract-state-integrity
Owner: Parfit
Size: M
Risk: Medium
Parallel-safe: yes
Upstream interference: Medium
Unblocked by: PRES-002

## Goal

Design a compatibility-safe split of `BoardSnapshot` into smaller read models without implementing the split yet.

## Why

`BoardSnapshot` currently combines entities, runtime status, mission events, controller state, knowledge, projections, and live synthesized handoff previews. This makes UI and server changes unnecessarily coupled.

## Layer Boundary

Allowed:
- `.plans/presence/decisions/`
- `.plans/presence/milestones/`

Not allowed:
- Contract changes
- Server query changes
- UI changes

## Clean Architecture Rule

Read models may aggregate state for views, but they must not become the domain source of truth.

## Acceptance Criteria

- Done: audit plan names proposed read models: board core, ticket detail, mission feed, controller state, projection health, knowledge.
- Done: plan explains compatibility wrapper strategy for existing `BoardSnapshot`.
- Done: plan identifies which existing UI panels should consume each read model.
- Done: plan lists migration-free first steps.

## Deliverable

- `.plans/presence/audits/PRES-005-board-snapshot-split-plan.md`

## Test Plan

No code tests required.

## Rollback

Delete decision record.
