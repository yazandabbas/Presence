# PRES-029: Extract Ticket Evidence Sections

Status: DONE
Milestone: 06-ui-product-pass
Owner: unassigned
Size: L
Risk: Medium
Parallel-safe: no
Upstream interference: Medium
Depends on: PRES-028

## Goal

Break `TicketWorkspace` into focused evidence sections for summary, policy gates, findings, review evidence, handoffs, timeline, and advanced actions.

## Why

`TicketWorkspace` is too large to safely evolve. Presence needs an inspectable evidence panel, and each evidence type should have a small component with clear inputs and tests.

## Layer Boundary

Allowed:
- `apps/web/src/components/presence/PresenceGuidedViews.tsx`
- new focused components under `apps/web/src/components/presence/`
- `apps/web/src/components/presence/PresencePresentation.ts`
- focused tests

Not allowed:
- Server API changes
- Contract changes
- Changing review/merge policy semantics

## Clean Architecture Rule

Evidence sections render records and invoke command callbacks. They must not decide whether work is accepted, merged, stale, or blocked.

## Acceptance Criteria

- Ticket summary/state header is separated from evidence sections.
- Findings/follow-ups section is separated.
- Review evidence section is separated.
- Worker handoff section is separated.
- Timeline section is separated.
- Advanced actions remain secondary.
- Existing review/accept/merge/request-changes behavior remains routed through the command facade.

## Test Plan

Run Presence guided view tests, dashboard tests, command registry tests, and `bun typecheck`.

## Rollback

Inline section components back into `TicketWorkspace`.
