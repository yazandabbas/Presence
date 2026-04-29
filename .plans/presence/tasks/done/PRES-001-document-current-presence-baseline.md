# PRES-001: Document Current Presence Baseline

Status: DONE
Milestone: 00-baseline-and-scope
Owner: unassigned
Size: S
Risk: Low
Parallel-safe: yes
Upstream interference: Low
Completed audit: `../../audits/PRES-001-current-presence-baseline.md`

## Goal

Document the current Presence happy path and known failure paths without changing runtime behavior.

## Why

The branch already contains a broad Presence implementation. Future work needs a shared baseline so fixes do not accidentally redefine product behavior.

## Layer Boundary

Allowed:
- `.plans/presence/`
- `.docs/` if a durable user-facing architecture note is justified

Not allowed:
- Runtime code
- Contracts
- Tests
- UI code

## Clean Architecture Rule

Documentation must describe current server-owned state and UI behavior separately. Do not imply that the UI is the domain source of truth.

## Acceptance Criteria

- Happy path covers repo import, goal intake, planning, worker attempt, review, merge approval, and cleanup.
- Failure path section covers stale projection, duplicate review, provider unavailable, malformed review result, and stuck controller.
- Each described behavior links to current files or migrations.
- Open questions are explicit.

## Test Plan

No code tests required. Run `git diff --check`.

## Rollback

Delete the new documentation file.
