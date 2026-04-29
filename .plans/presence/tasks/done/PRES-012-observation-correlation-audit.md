# PRES-012: Observation Correlation Audit

Status: DONE
Milestone: 04-runtime-observation
Owner: unassigned
Size: S
Risk: Low
Parallel-safe: yes
Upstream interference: Low

## Goal

Audit how `PresenceObservationService` correlates provider and orchestration events to boards, tickets, attempts, supervisor runs, and threads.

## Why

Presence should depend on stable correlation keys, not raw provider payload quirks or UI subscription behavior.

## Layer Boundary

Allowed:
- `.plans/presence/audits/`
- observation tests if a tiny missing fixture is needed

Not allowed:
- Provider runtime implementation changes
- UI changes
- Contract changes

## Clean Architecture Rule

Observation may translate external events into mission evidence. It must not become the supervisor policy engine.

## Acceptance Criteria

- Audit lists every correlation key currently used.
- Audit identifies unstable keys and safer replacements.
- Audit identifies replay/dedupe gaps.
- Audit recommends first hardening task.

## Test Plan

No code tests required unless fixtures are added.

## Rollback

Delete audit file or revert fixture additions.
