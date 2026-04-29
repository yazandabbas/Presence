# PRES-013: Tool Bridge First Reporting

Status: DONE
Milestone: 04-runtime-observation
Owner: Codex
Size: M
Risk: Medium
Parallel-safe: no
Upstream interference: Medium

## Goal

Make Presence tool reports the primary structured channel where available, with assistant text blocks remaining as compatibility fallback.

## Why

Markdown block parsing is fragile. Native tool reports are easier to validate, dedupe, and audit.

## Layer Boundary

Allowed:
- `apps/server/src/presence/Layers/internal/PresenceToolBridge.ts`
- `apps/server/src/presence/Layers/internal/PresencePrompting.ts`
- `apps/server/src/presence/Layers/PresenceObservationService.ts`
- focused tests

Not allowed:
- Direct Codex runtime imports from Presence
- Broad provider contract redesign
- UI changes

## Clean Architecture Rule

Provider-specific tool plumbing stays behind the tool bridge. Worker/reviewer services consume normalized mission reports.

## Acceptance Criteria

- Prompts identify Presence tools as the primary reporting channel and fallback blocks as provider compatibility only.
- Runtime observation classifies Presence tool reports before generic runtime request events.
- Malformed tool payloads become manual mission blockers with human-readable detail.
- Tests cover worker progress, blocker, evidence, review result, malformed payload, and tool-before-fallback observation behavior.

## Test Plan

Validated:
- `Push-Location apps\server; bun run test src/presence/Layers/internal/PresenceToolBridge.test.ts; Pop-Location`
- `Push-Location apps\server; bun run test src/presence/Layers/PresenceObservationService.test.ts; Pop-Location`
- `Push-Location apps\server; bun run typecheck; Pop-Location`
- `bun fmt`
- `bun lint`

## Rollback

Revert tool-bridge/prompt/observation changes.
