# PRES-021: Memory Provenance Design

Status: DONE
Milestone: 07-repo-brain
Owner: unassigned
Size: M
Risk: Medium
Parallel-safe: yes
Upstream interference: Low

## Goal

Design provenance metadata for repo-brain memory and promotion candidates.

## Why

Memory must be inspectable and evidence-backed. Without provenance, stale memory becomes worse than no memory.

## Layer Boundary

Allowed:
- `.plans/presence/decisions/`
- `.plans/presence/milestones/07-repo-brain.md`

Not allowed:
- Schema changes
- Projection runtime changes
- UI changes

## Clean Architecture Rule

Memory is a projection from evidence. It must never become the orchestration source of truth.

## Acceptance Criteria

- Design includes source ticket, attempt, mission event, review artifact, file path, command/test, timestamp, confidence, status, and invalidation trigger.
- Design distinguishes compiled truth from timeline evidence.
- Design includes read-write/read-only/deny trust modes.
- Design lists minimal first implementation tasks.
- Decision recorded in `.plans/presence/decisions/2026-04-29-repo-brain-memory-provenance.md`.
- Follow-up tasks created for schema, projection, promotion lifecycle, markdown projection, retrieval, UI inspection, and regression coverage.

## Test Plan

No code tests required.

## Rollback

Delete decision record.
