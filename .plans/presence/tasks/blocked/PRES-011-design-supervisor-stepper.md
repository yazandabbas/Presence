# PRES-011: Design Supervisor Stepper

Status: BLOCKED
Milestone: 03-resident-controller
Owner: unassigned
Size: M
Risk: Medium
Parallel-safe: yes
Upstream interference: Low
Depends on: PRES-010

## Goal

Write a decision record for replacing the long supervisor runtime loop with a persisted stepper.

## Why

The current supervisor runtime has an in-memory loop and the controller has a polling loop. They should converge into one resumable state machine before deeper autonomy work.

## Layer Boundary

Allowed:
- `.plans/presence/decisions/`

Not allowed:
- Code changes
- Contract changes
- UI changes

## Clean Architecture Rule

The stepper design must separate scheduling, state transition policy, and provider execution.

## Acceptance Criteria

- Decision defines step input, step output, persisted state, and retry behavior.
- Decision maps current stages to stepper actions.
- Decision explains how crashes resume.
- Decision identifies first implementation tasks.

## Test Plan

No code tests required.

## Rollback

Delete decision record.
