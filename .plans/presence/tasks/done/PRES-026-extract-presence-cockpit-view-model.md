# PRES-026: Extract Presence Cockpit View Model

Status: DONE
Milestone: 06-ui-product-pass
Owner: Codex
Size: M
Risk: Low
Parallel-safe: yes
Upstream interference: Low
Depends on: PRES-020

## Goal

Move cockpit status/count/recommendation derivation out of `PresenceBriefingSurface` into a pure web-local view-model helper.

## Why

The cockpit should be a command surface over server state, not JSX mixed with state policy labels. A pure view model makes the cockpit easier to test before visual refactors continue.

## Layer Boundary

Allowed:
- `apps/web/src/components/presence/PresenceGuidedViews.tsx`
- `apps/web/src/components/presence/PresencePresentation.ts`
- new focused file under `apps/web/src/components/presence/`
- focused web tests

Not allowed:
- Server API changes
- Contract changes
- New runtime policy

## Clean Architecture Rule

The view model may prioritize and label state, but it must derive from `BoardSnapshot`, command definitions, and query state. It must not decide ticket lifecycle transitions.

## Acceptance Criteria

- Cockpit counts and status line are produced by a pure helper.
- Projection health, controller mode, queued goals, active tickets, human-action count, and blocked count are represented in the view model.
- `PresenceBriefingSurface` renders from the view model instead of recomputing these values inline.
- Tests cover paused, needs-human, queued-goal, active-work, and idle states.

## Test Plan

Run focused Presence presentation/cockpit tests and `bun typecheck`.

## Completion Notes

Added `apps/web/src/components/presence/PresenceCockpitViewModel.ts` as a pure cockpit view-model helper over `BoardSnapshot` and the existing supervisor reason.

`PresenceBriefingSurface` now renders cockpit counts, status language, controller line, briefing summary, and projection health from that helper instead of recomputing those details in JSX.

Added `apps/web/src/components/presence/PresenceCockpitViewModel.test.ts` covering paused, needs-human, queued-goal, active-work, and idle states.

Validation:
- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run --filter @t3tools/web test -- PresenceCockpitViewModel.test.ts`

## Rollback

Inline the helper back into `PresenceBriefingSurface`.
