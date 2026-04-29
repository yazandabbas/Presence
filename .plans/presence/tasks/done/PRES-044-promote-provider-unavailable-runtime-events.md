# PRES-044: Promote Provider-Unavailable Runtime Events

Status: Done

## Goal

Make provider and harness failures visible as actionable Presence mission state instead of allowing tickets to look idle while the underlying runtime is unavailable.

## Implementation

Expanded runtime observation classification so auth failures, provider transport errors, permission errors, session error state, unrecoverable session exits, failed MCP authentication, and exhausted provider rate limits promote to `provider_unavailable` mission events when they are thread-correlated. Manual provider failures now carry human actions that flow into ticket mission briefings.

Updated mission control so manual `provider_unavailable` events participate in the existing human-blocker decision path alongside manual runtime errors. Presence can now stop and ask for account or harness repair instead of silently retrying the same broken lane.

Kept the boundary additive and Presence-local: provider adapters still emit canonical runtime events, the observation service classifies them, and the store remains responsible only for persistence, dedupe, and mission-state refresh.

## Validation

Focused validation passed with `bun run --filter t3 test -- PresenceObservationService.test.ts PresenceMissionControl.test.ts`.
