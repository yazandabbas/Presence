# PRES-004: Audit Presence Migrations 026-039

Status: DONE
Milestone: 01-contract-state-integrity
Owner: unassigned
Size: S
Risk: Low
Parallel-safe: yes
Upstream interference: Low

## Goal

Audit Presence migrations for append-only behavior, idempotency, naming clarity, and accidental churn.

## Why

Presence persistence is the continuity kernel. Migration instability creates hard-to-debug product failures and fork friction.

## Layer Boundary

Allowed:
- `.plans/presence/audits/`
- migration tests if gaps are found

Not allowed:
- Editing existing migrations unless fixing a confirmed compatibility issue
- Renumbering migrations

## Clean Architecture Rule

Migrations define storage shape only. Do not hide runtime behavior or policy in migration scripts.

## Acceptance Criteria

- Audit covers migrations `026_PresenceDomain` through `039_PresenceResidentController`.
- Audit notes non-Presence migration numbering confusion around canonical model selection.
- Audit identifies any non-idempotent `ALTER TABLE` patterns.
- Audit records whether old migration file churn should be reverted.

## Test Plan

No code tests required unless migration tests are added. If tests are added, run focused server migration tests.

## Rollback

Delete audit file or revert test additions.
