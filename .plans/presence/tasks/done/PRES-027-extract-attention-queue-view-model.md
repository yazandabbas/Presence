# PRES-027: Extract Attention Queue View Model

Status: DONE
Milestone: 06-ui-product-pass
Owner: Codex
Size: M
Risk: Low
Parallel-safe: yes
Upstream interference: Low
Depends on: PRES-020

## Goal

Move `WorkQueueSurface` row ordering and row label derivation into a pure attention queue view-model helper.

## Why

The attention queue is the heart of the Presence cockpit. Its ordering must be predictable, testable, and evidence-backed instead of hidden inside JSX.

## Layer Boundary

Allowed:
- `apps/web/src/components/presence/PresenceGuidedViews.tsx`
- `apps/web/src/components/presence/PresencePresentation.ts`
- new focused file under `apps/web/src/components/presence/`
- focused web tests

Not allowed:
- Server API changes
- Contract changes
- New ticket lifecycle logic

## Clean Architecture Rule

The queue may sort and group records for attention. Server-owned `missionBriefing`, `ticketBriefings`, ticket status, attempts, findings, review artifacts, merge operations, and mission events remain the source of truth.

## Acceptance Criteria

- A pure helper returns queued-goal and ticket row view models.
- Rows include id, kind, title, detail, stage label, latest update, latest update timestamp, waiting-for line, selected state, and attention tone.
- Human-needed rows sort before routine active work.
- Existing UI behavior remains visually equivalent for the current dashboard.
- Tests cover queued goals, human-action tickets, blocked tickets, active tickets, done tickets, and selected row state.

## Test Plan

Run focused attention queue tests, dashboard tests, and `bun typecheck`.

## Completion Notes

Added `apps/web/src/components/presence/PresenceAttentionQueueViewModel.ts` as a pure helper for queued-goal and ticket attention rows.

`WorkQueueSurface` now renders rows from the helper instead of deriving queued goals, ticket sort order, stage labels, latest updates, waiting lines, human-action labels, and selected state inline.

Added `apps/web/src/components/presence/PresenceAttentionQueueViewModel.test.ts` covering queued goals, human-action priority, blocked/active/done tones, selected row state, and empty state.

Validation:
- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run --filter @t3tools/web test -- PresenceAttentionQueueViewModel.test.ts PresenceDashboard.test.tsx`

## Rollback

Inline row derivation back into `WorkQueueSurface`.
