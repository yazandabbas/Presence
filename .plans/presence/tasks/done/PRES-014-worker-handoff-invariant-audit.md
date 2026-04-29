# PRES-014: Worker Handoff Invariant Audit

Status: DONE
Milestone: 05-agentic-loops
Owner: unassigned
Size: S
Risk: Low
Parallel-safe: yes
Upstream interference: Low

## Goal

Define the required fields and validation invariants for worker handoffs.

## Why

Worker handoffs are the continuity layer between disposable agent sessions. They must transfer state, not just summarize activity.

## Layer Boundary

Allowed:
- `.plans/presence/decisions/`
- `.plans/presence/audits/`

Not allowed:
- Code changes
- Prompt changes

## Clean Architecture Rule

Handoff invariants should be domain-level contracts. Prompt wording is an implementation detail.

## Acceptance Criteria

- Audit defines required handoff content: objective, changed files, commands, blockers, next step, confidence, evidence.
- Audit identifies which current fields are insufficient.
- Audit defines receiver sanity checks.
- Audit proposes tests before implementation.

## Test Plan

No code tests required.

## Rollback

Delete audit/decision file.
