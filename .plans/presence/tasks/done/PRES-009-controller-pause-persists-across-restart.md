# PRES-009: Controller Pause Persists Across Restart

Status: DONE
Milestone: 03-resident-controller
Owner: Codex
Size: S
Risk: Medium
Parallel-safe: yes
Upstream interference: Low

## Goal

Pausing a Presence board must persist in `presence_board_controller_state` and survive service restart or store reconstruction.

## Why

The human needs a reliable administrative stop. Pause cannot be a UI-only or process-local state.

## Layer Boundary

Allowed:
- `apps/server/src/presence/Layers/PresenceControllerService.ts`
- `apps/server/src/presence/Layers/PresenceControllerService.test.ts`
- `apps/server/src/presence/Layers/internal/PresenceStore.ts` only if read/write support is missing

Not allowed:
- Web UI changes
- Provider runtime changes
- Prompt changes

## Clean Architecture Rule

Controller mode is durable domain state. UI may display and request it, but not simulate it.

## Acceptance Criteria

- `setControllerMode({ mode: "paused" })` persists paused mode in durable controller state.
- Controller tick does not create worker/supervisor thread work while paused.
- Snapshot returns paused `controllerState` after the controller service starts again.
- Repeating the same pause mode is idempotent and records only one pause mission event.

## Test Plan

Validated:
- `Push-Location apps\server; bun run test src/presence/Layers/PresenceControllerService.test.ts; Pop-Location`
- `Push-Location apps\server; bun run typecheck; Pop-Location`

## Rollback

Revert controller/store/test changes.
