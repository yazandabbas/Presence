# PRES-022: Memory Promotion Policy

Status: DONE
Milestone: 07-repo-brain
Owner: unassigned
Size: S
Risk: Low
Parallel-safe: yes
Upstream interference: Low
Depends on: PRES-021

## Goal

Define when a worker/reviewer/supervisor output may become a durable repo-brain memory candidate.

## Why

Silent memory writes are dangerous. Presence should propose memory, not automatically rewrite durable repo truth.

## Layer Boundary

Allowed:
- `.plans/presence/decisions/`

Not allowed:
- Code changes
- Prompt changes

## Clean Architecture Rule

Only reviewed evidence may be promoted to durable memory. Failed attempts may produce lessons, but not unquestioned facts.

## Acceptance Criteria

- Policy defines allowed sources for memory candidates.
- Policy defines accept/edit/reject flow.
- Policy defines stale/disputed/historical states.
- Policy defines which memories can be loaded into supervisor briefings.
- Decision recorded in `.plans/presence/decisions/2026-04-29-memory-promotion-policy.md`.

## Test Plan

No code tests required.

## Rollback

Delete policy decision record.
