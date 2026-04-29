# PRES-006: Normalize Mission Event Dedupe Keys

Status: DONE
Milestone: 02-store-invariants
Owner: Codex
Size: M
Risk: Medium
Parallel-safe: no
Upstream interference: Low

## Goal

Audit and normalize mission event dedupe keys so replay, reconnect, retry, and tool reports do not create duplicate product-visible events.

## Why

Mission events are the ledger the UI and supervisor should trust. Duplicate or unstable dedupe keys make Presence look confused and can trigger repeated work.

## Layer Boundary

Allowed:
- `apps/server/src/presence/Layers/internal/PresenceMissionControl.ts`
- `apps/server/src/presence/Layers/PresenceObservationService.ts`
- `apps/server/src/presence/Layers/internal/PresenceToolBridge.ts`
- focused tests for those modules

Not allowed:
- UI changes
- Provider runtime internals
- Contract changes unless a missing field is proven necessary

## Clean Architecture Rule

Dedupe belongs at the mission-event write boundary. UI code must not suppress duplicates locally.

## Acceptance Criteria

- Done: runtime provider events prefer stable provider/request/item/turn identity and fall back to a stable payload hash.
- Done: provider event replay no longer creates duplicate mission events when regenerated event IDs carry equivalent payloads.
- Done: Presence tool call reports dedupe by board, thread, tool, and provider call identity, with stable payload-hash fallback.
- Done: malformed Presence tool reports use board-scoped deterministic fallback keys.

## Test Plan

Add or update focused tests for mission control, observation, and tool bridge replay cases. Run:
- `bun run --filter @t3tools/server test src/presence/Layers/internal/PresenceMissionControl.test.ts`
- `bun run --filter @t3tools/server test src/presence/Layers/internal/PresenceToolBridge.test.ts`
- relevant observation test if present

Validated with:
- `bun run test src/presence/Layers/internal/PresenceMissionControl.test.ts src/presence/Layers/internal/PresenceToolBridge.test.ts src/presence/Layers/PresenceObservationService.test.ts src/presence/Layers/internal/PresenceShared.test.ts`
- `bun run typecheck` in `apps/server`

## Rollback

Revert dedupe-key changes and associated tests.
