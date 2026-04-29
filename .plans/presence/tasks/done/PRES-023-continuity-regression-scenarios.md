# PRES-023: Continuity Regression Scenarios

Status: DONE
Milestone: 08-release-readiness
Owner: Codex
Size: M
Risk: Medium
Parallel-safe: yes
Upstream interference: Low

## Goal

Define a small set of regression scenarios that prove Presence continuity is improving.

## Why

Presence should be evaluated by recovery and continuity, not just by final diffs or happy-path UI rendering.

## Layer Boundary

Allowed:
- `.plans/presence/audits/`
- `.plans/presence/milestones/08-release-readiness.md`

Not allowed:
- Test implementation
- Runtime code

## Clean Architecture Rule

Evaluation scenarios must measure externally observable behavior and durable state, not internal model confidence.

## Acceptance Criteria

- Scenario list covers restart during worker attempt.
- Scenario list covers duplicate review retry.
- Scenario list covers stale memory candidate rejection.
- Scenario list covers provider unavailable blocker.
- Scenario list covers goal planning and correction after human direction.
- Each scenario states pass/fail evidence and a release gate.

## Test Plan

No code tests required. Documented in:
- `.plans/presence/audits/PRES-023-continuity-regression-scenarios.md`
- `.plans/presence/milestones/08-release-readiness.md`

## Rollback

Delete scenario audit.
